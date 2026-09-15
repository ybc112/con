/**
 * 伞下业绩爬取核心 —— 逻辑与 con-downline-report.cjs 一致（已通过 30 项单元测试
 * 与本地链端到端验证），此处抽成常驻服务可用的模块。
 *
 * 关键正确性保证（勿改）：
 *  1. 所有调用携带 blockTag，快照固定，结果可复现
 *  2. RPC 失败重试后抛出，不静默把业绩记 0（结算场景下静默少算钱最危险）
 *  3. 每层 info 在本层内取齐，depth 截断时最后一层业绩不会丢
 */
const { ethers } = require('ethers');

const RPC_FALLBACKS = [
  'https://rpc-bsc.48.club',
  'https://bsc.publicnode.com',
  'https://bsc-dataseed.binance.org/',
];

const ABI = [
  'function getUserInfo(address user) view returns (tuple(uint256 totalStaked, uint256 totalWithdrawn, uint256 stakeCount, uint256 activeStakeCount, address referrer, uint256 directReferrals, uint256 referralStakeVolume, uint256 personalStakeVolume, uint256 pendingInviteRewards, uint256 totalInviteClaimed, uint256 lockedInviteRewards, uint256 inviteUnlockCursor) info, uint256 pendingRewards, uint256 totalClaimed, uint256 rank)',
  'function getReferralsPaginated(address user, uint256 offset, uint256 limit) view returns (address[] result, uint256 total)',
];

const PAGE_SIZE = 200;
const CONCURRENCY = 8;

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetry(fn, retries = 4) {
  let lastError;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      await sleep(400 * (i + 1));
    }
  }
  throw lastError;
}

function createReader(contract, blockTag, cache) {
  return async function fetchUser(address) {
    const key = address.toLowerCase();
    if (cache.has(key)) return cache.get(key);
    const result = await withRetry(() => contract.getUserInfo(address, { blockTag }));
    const info = result.info ?? result[0];
    const value = {
      address,
      totalStaked: BigInt(info.totalStaked),
      personalStakeVolume: BigInt(info.personalStakeVolume),
      referralStakeVolume: BigInt(info.referralStakeVolume),
      directReferrals: Number(info.directReferrals),
      referrer: info.referrer,
    };
    cache.set(key, value);
    return value;
  };
}

async function getDirectReferrals(contract, address, blockTag) {
  const all = [];
  let offset = 0;
  for (;;) {
    const [result, total] = await withRetry(() =>
      contract.getReferralsPaginated(address, offset, PAGE_SIZE, { blockTag })
    );
    const page = Array.from(result);
    all.push(...page);
    if (page.length === 0 || all.length >= Number(total)) break;
    offset += page.length;
  }
  return all;
}

async function walkDownline({ fetchUser, getReferrals, leader, depth, maxNodes }) {
  const visited = new Set([leader.toLowerCase()]);
  const levels = [];
  let frontier = [leader];
  let visitedCount = 0;

  for (let d = 1; d <= depth; d++) {
    const childrenLists = await mapLimit(frontier, CONCURRENCY, (addr) => getReferrals(addr));
    const next = [];
    for (const children of childrenLists) {
      for (const child of children) {
        const key = child.toLowerCase();
        if (visited.has(key)) continue;
        visited.add(key);
        next.push(child);
      }
    }
    if (next.length === 0) break;

    visitedCount += next.length;
    if (visitedCount > maxNodes) {
      throw new Error(`伞下节点数超过上限 ${maxNodes}，已中止`);
    }

    const infos = await mapLimit(next, CONCURRENCY, (addr) => fetchUser(addr));
    let cumulative = 0n;
    let active = 0n;
    let activeCount = 0;
    for (const info of infos) {
      cumulative += info.totalStaked;
      active += info.personalStakeVolume;
      if (info.personalStakeVolume > 0n) activeCount += 1;
    }
    levels.push({ depth: d, count: next.length, activeCount, cumulative, active });
    frontier = next;
  }

  return levels;
}

async function buildLeaderReport({ leader, fetchUser, getReferrals, depth, maxNodes }) {
  const self = await fetchUser(leader);
  const levels = await walkDownline({ fetchUser, getReferrals, leader, depth, maxNodes });

  const sum = (key) => levels.reduce((acc, l) => acc + l[key], 0n);
  const total = (key) => levels.reduce((acc, l) => acc + l[key], 0);
  const first = levels[0];

  return {
    address: leader,
    levels,
    downlineCount: total('count'),
    downlineActiveCount: total('activeCount'),
    downlineCumulative: sum('cumulative'),
    downlineActive: sum('active'),
    directCount: first?.count ?? 0,
    directCumulative: first?.cumulative ?? 0n,
    directActive: first?.active ?? 0n,
    selfCumulative: self.totalStaked,
    selfActive: self.personalStakeVolume,
    selfDirectReferrals: self.directReferrals,
    selfReferralVolume: self.referralStakeVolume,
  };
}

async function createProvider(rpcUrl) {
  const urls = rpcUrl ? [rpcUrl] : RPC_FALLBACKS;
  const errors = [];
  for (const url of urls) {
    try {
      const provider = new ethers.JsonRpcProvider(url, undefined, {
        staticNetwork: true,
        requestTimeout: 20000,
      });
      await provider.getBlockNumber();
      return { provider, url };
    } catch (err) {
      errors.push(`${url}: ${err.shortMessage || err.message}`);
    }
  }
  throw new Error('所有 RPC 均不可用:\n  ' + errors.join('\n  '));
}

/**
 * 跑一轮完整报表。返回可直接 JSON 序列化的结构（BigInt 已转字符串）。
 */
async function runReport({ leaders, contractAddress, depth = 20, maxNodes = 50000, rpcUrl = '' }) {
  const startedAt = Date.now();
  const { provider, url } = await createProvider(rpcUrl);

  const code = await provider.getCode(contractAddress);
  if (code === '0x') throw new Error(`地址 ${contractAddress} 上无合约代码，请确认 RPC 指向正确的链`);

  const blockTag = await provider.getBlockNumber();
  const contract = new ethers.Contract(contractAddress, ABI, provider);
  const cache = new Map();
  const fetchUser = createReader(contract, blockTag, cache);
  const getReferrals = (address) => getDirectReferrals(contract, address, blockTag);

  const rows = [];
  for (const leader of leaders) {
    const r = await buildLeaderReport({ leader, fetchUser, getReferrals, depth, maxNodes });
    rows.push({
      address: r.address,
      downlineCount: r.downlineCount,
      downlineActiveCount: r.downlineActiveCount,
      downlineCumulative: ethers.formatEther(r.downlineCumulative),
      downlineActive: ethers.formatEther(r.downlineActive),
      directCount: r.directCount,
      directCumulative: ethers.formatEther(r.directCumulative),
      directActive: ethers.formatEther(r.directActive),
      selfCumulative: ethers.formatEther(r.selfCumulative),
      selfActive: ethers.formatEther(r.selfActive),
      selfDirectReferrals: r.selfDirectReferrals,
      selfReferralVolume: ethers.formatEther(r.selfReferralVolume),
      levels: r.levels.map((l) => ({
        depth: l.depth,
        count: l.count,
        activeCount: l.activeCount,
        cumulative: ethers.formatEther(l.cumulative),
        active: ethers.formatEther(l.active),
      })),
    });
  }

  return {
    ok: true,
    block: blockTag,
    rpc: url,
    contract: contractAddress,
    depth,
    leadersRequested: leaders.length,
    addressesRead: cache.size,
    elapsedMs: Date.now() - startedAt,
    generatedAt: new Date().toISOString(),
    rows,
  };
}

module.exports = { runReport, ABI };
