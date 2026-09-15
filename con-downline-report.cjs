#!/usr/bin/env node
/**
 * ============================================================
 *  CON 质押项目 —— 团队长伞下业绩结算脚本
 * ============================================================
 *  背景：合约只记录「直推（第一代）」数据（referralStakeVolume / directReferrals），
 *        没有任何伞下聚合函数。本脚本通过链下遍历推荐树，算出每个团队长的伞下总业绩，
 *        用于按业绩额外结算团队奖金。
 *
 *  数据来源（全部为链上只读调用，不涉及私钥）：
 *    getUserInfo(address)                  → 本人业绩、直推人数、直推业绩
 *    getReferralsPaginated(address,o,l)    → 某地址的直推列表（分页）
 *
 *  用法：
 *    node con-downline-report.cjs --leaders 0xAAA,0xBBB
 *    node con-downline-report.cjs --leaders-file leaders.txt --metric cumulative
 *    node con-downline-report.cjs --leaders 0xAAA --depth 5 --out report.csv
 *
 *  参数：
 *    --leaders <a,b,c>       团队长地址，逗号分隔
 *    --leaders-file <path>   团队长地址文件（每行一个，# 开头为注释）
 *    --metric <volume|cumulative>   业绩口径，默认 volume
 *                            volume     = 当前有效业绩（U 本位，与前端「邀请质押价值」一致，提取会减少）
 *                            cumulative = 累计质押量（CON，只增不减）
 *    --depth <n>             遍历深度，默认 20（合约 MAX_REFERRAL_DEPTH 上限）
 *    --block <n>             快照区块，默认取脚本启动时的最新区块
 *    --rpc <url>             自定义 RPC
 *    --out <path>            输出 CSV 路径，默认 downline-report-<区块>.csv
 *    --level-cols <n>        每个层级单独输出的列数，默认 10（超出部分仍计入总计）
 *    --max-nodes <n>         遍历节点数安全上限，默认 50000
 *    --contract <address>    质押合约地址，默认主网 0x0B3943...C8000
 *    --no-csv                只打印汇总表，不写文件
 *
 *  注意：
 *    1. 业绩数字随时间变化，结算务必用 --block 固定快照，否则每次跑结果不同。
 *    2. 口径差异：团队长在自己页面上看到的「邀请质押价值」是 volume 口径（提取会减少）。
 *       若按 cumulative 结算，团队长看到的数字会比自己页面小，需提前说明。
 *    3. 遍历耗时与伞下人数成正比（每人 2 次 RPC 调用）。上万人建议分批跑。
 * ============================================================
 */
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

// ---------------- 配置 ----------------
const STAKING_BANK = '0x0B3943E0851341164D859DB56B6502c786EC8000';
const CHAIN_ID = 56;
const RPC_FALLBACKS = [
  'https://rpc-bsc.48.club',
  'https://bsc.publicnode.com',
  'https://bsc-dataseed.binance.org/',
];

// 只声明用得到的接口。注意 getUserInfo 返回的是合约里的 UserInfo 结构体，
// 字段顺序必须与合约一致，否则解出来的数字会错位。
const ABI = [
  'function getUserInfo(address user) view returns (tuple(uint256 totalStaked, uint256 totalWithdrawn, uint256 stakeCount, uint256 activeStakeCount, address referrer, uint256 directReferrals, uint256 referralStakeVolume, uint256 personalStakeVolume, uint256 pendingInviteRewards, uint256 totalInviteClaimed, uint256 lockedInviteRewards, uint256 inviteUnlockCursor) info, uint256 pendingRewards, uint256 totalClaimed, uint256 rank)',
  'function getReferralsPaginated(address user, uint256 offset, uint256 limit) view returns (address[] result, uint256 total)',
];

const PAGE_SIZE = 200;
const CONCURRENCY = 8;

// ---------------- 工具 ----------------

/** 并发限制的 map，避免瞬间打爆 RPC */
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

/** 带重试的 RPC 调用 */
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

/**
 * 口径取值函数。
 *  - volume     : personalStakeVolume —— U 本位当前有效业绩（提取会扣减）
 *  - cumulative : totalStaked        —— 累计质押量，只增不减
 */
function pickMetric(info, metric) {
  return metric === 'cumulative' ? BigInt(info.totalStaked) : BigInt(info.personalStakeVolume);
}

const fmtEther = (v) => Number(ethers.formatEther(v));

// ---------------- 链上读取 ----------------

/** 读取单个地址的信息，带缓存（同一地址在多个团队长的伞下不会重复请求） */
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

/** 取某地址的全部直推（自动翻页） */
async function getDirectReferrals(contract, address, blockTag) {
  const all = [];
  let offset = 0;
  for (;;) {
    const [result, total] = await withRetry(() =>
      contract.getReferralsPaginated(address, offset, PAGE_SIZE, { blockTag })
    );
    const page = Array.from(result);
    all.push(...page);
    const totalNum = Number(total);
    if (page.length === 0 || all.length >= totalNum) break;
    offset += page.length;
  }
  return all;
}

/**
 * 遍历某团队长的伞下树（BFS，逐层）。
 * 返回每层的 { count, volume }，不含团队长本人。
 */
async function walkDownline({ fetchUser, getReferrals, leader, depth, metric, maxNodes }) {
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
        if (visited.has(key)) continue; // 防环路（合约已禁止，这里再兜一层）
        visited.add(key);
        next.push(child);
      }
    }
    if (next.length === 0) break;

    visitedCount += next.length;
    if (visitedCount > maxNodes) {
      throw new Error(`伞下节点数超过安全上限 ${maxNodes}，已中止。可调大 --max-nodes`);
    }

    // 本层所有人的业绩
    const infos = await mapLimit(next, CONCURRENCY, (addr) => fetchUser(addr));
    let volume = 0n;
    let activeCount = 0;
    for (const info of infos) {
      const v = pickMetric(info, metric);
      volume += v;
      if (v > 0n) activeCount += 1;
    }

    levels.push({ depth: d, count: next.length, activeCount, volume });
    frontier = next;
  }

  return levels;
}

/**
 * 生成一个团队长的完整报告。
 * 独立导出，便于用 mock 合约做单元测试。
 */
async function buildLeaderReport({ leader, fetchUser, getReferrals, depth, metric, maxNodes }) {
  const self = await fetchUser(leader);
  const levels = await walkDownline({ fetchUser, getReferrals, leader, depth, metric, maxNodes });

  const totalCount = levels.reduce((sum, l) => sum + l.count, 0);
  const totalActive = levels.reduce((sum, l) => sum + l.activeCount, 0);
  const totalVolume = levels.reduce((sum, l) => sum + l.volume, 0n);

  return {
    address: leader,
    levels,
    downlineCount: totalCount,
    downlineActiveCount: totalActive,
    downlineVolume: totalVolume,
    directCount: levels[0]?.count ?? 0,
    directVolume: levels[0]?.volume ?? 0n,
    selfVolume: pickMetric(self, metric),
    selfStaked: self.totalStaked,
    selfPersonalVolume: self.personalStakeVolume,
    selfReferralVolume: self.referralStakeVolume,
  };
}

// ---------------- 参数解析 ----------------

function parseArgs(argv) {
  const args = {
    leaders: '',
    leadersFile: '',
    metric: 'volume',
    depth: 20,
    block: null,
    rpc: '',
    out: '',
    levelCols: 10,
    maxNodes: 50000,
    contract: '',
    csv: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--leaders') args.leaders = next();
    else if (a === '--leaders-file') args.leadersFile = next();
    else if (a === '--metric') args.metric = next();
    else if (a === '--depth') args.depth = Number(next());
    else if (a === '--block') args.block = Number(next());
    else if (a === '--rpc') args.rpc = next();
    else if (a === '--out') args.out = next();
    else if (a === '--level-cols') args.levelCols = Number(next());
    else if (a === '--max-nodes') args.maxNodes = Number(next());
    else if (a === '--contract') args.contract = next();
    else if (a === '--no-csv') args.csv = false;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function collectLeaders(args) {
  const list = [];
  if (args.leaders) list.push(...args.leaders.split(','));
  if (args.leadersFile) {
    const text = fs.readFileSync(args.leadersFile, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      list.push(t);
    }
  }
  const seen = new Set();
  const valid = [];
  for (const raw of list) {
    const addr = raw.trim();
    if (!addr) continue;
    if (!ethers.isAddress(addr)) {
      console.warn(`  ⚠️  跳过非法地址: ${addr}`);
      continue;
    }
    const key = addr.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    valid.push(ethers.getAddress(addr));
  }
  return valid;
}

// ---------------- 输出 ----------------

function buildCsv(rows, metric, block, maxLevelShown) {
  const headers = ['团队长地址', '伞下总人数', '伞下有效人数', '伞下总业绩'];
  for (let d = 1; d <= maxLevelShown; d++) {
    headers.push(`L${d}人数`, `L${d}业绩`);
  }
  headers.push('直推人数', '直推业绩', '本人业绩', '本人累计质押');

  const lines = [headers.join(',')];
  for (const r of rows) {
    const cells = [
      r.address,
      r.downlineCount,
      r.downlineActiveCount,
      fmtEther(r.downlineVolume).toFixed(4),
    ];
    for (let d = 1; d <= maxLevelShown; d++) {
      const lv = r.levels.find((l) => l.depth === d);
      cells.push(lv ? lv.count : 0, lv ? fmtEther(lv.volume).toFixed(4) : '0.0000');
    }
    cells.push(
      r.directCount,
      fmtEther(r.directVolume).toFixed(4),
      fmtEther(r.selfVolume).toFixed(4),
      fmtEther(r.selfStaked).toFixed(4)
    );
    lines.push(cells.join(','));
  }
  return lines.join('\n');
}

function printSummary(rows, metric, block) {
  const unit = metric === 'cumulative' ? 'CON' : 'U';
  const metricLabel = metric === 'cumulative' ? '累计质押量（CON，只增不减）' : '当前有效业绩（U，提取会减少）';

  console.log('');
  console.log('='.repeat(96));
  console.log(`口径: ${metricLabel}`);
  console.log(`快照区块: ${block}`);
  console.log('='.repeat(96));
  console.log(
    '团队长'.padEnd(44) + '伞下人数'.padStart(10) + '伞下业绩'.padStart(20) + '直推业绩'.padStart(20)
  );
  console.log('-'.repeat(96));

  let totalVolume = 0n;
  for (const r of rows) {
    totalVolume += r.downlineVolume;
    const short = `${r.address.slice(0, 10)}...${r.address.slice(-8)}`;
    console.log(
      short.padEnd(44) +
      String(r.downlineCount).padStart(10) +
      `${fmtEther(r.downlineVolume).toFixed(2)} ${unit}`.padStart(20) +
      `${fmtEther(r.directVolume).toFixed(2)} ${unit}`.padStart(20)
    );
  }
  console.log('-'.repeat(96));
  console.log(`合计伞下业绩: ${fmtEther(totalVolume).toFixed(2)} ${unit}`);

  console.log('');
  console.log('各团队长层级明细:');
  for (const r of rows) {
    if (r.levels.length === 0) {
      console.log(`  ${r.address}  伞下暂无成员`);
      continue;
    }
    const parts = r.levels.map((l) => `L${l.depth}: ${l.count}人 / ${fmtEther(l.volume).toFixed(2)}`);
    console.log(`  ${r.address}`);
    console.log(`    ${parts.join('   ')}`);
    console.log(
      `    合计: ${r.downlineCount}人 (其中 ${r.downlineActiveCount} 人有业绩) / ${fmtEther(r.downlineVolume).toFixed(2)} ${unit}`
    );
  }
}

// ---------------- 主流程 ----------------

async function createProvider(rpcUrl) {
  const urls = rpcUrl ? [rpcUrl] : RPC_FALLBACKS;
  const errors = [];
  for (const url of urls) {
    try {
      // 不写死 chainId，交给 ethers 自动识别，便于对接本地链 / 测试网
      const provider = new ethers.JsonRpcProvider(url, undefined, {
        staticNetwork: true,
        requestTimeout: 20000,
      });
      await provider.getBlockNumber();
      console.log(`RPC: ${url}`);
      return provider;
    } catch (err) {
      errors.push(`${url}: ${err.shortMessage || err.message}`);
    }
  }
  throw new Error('所有 RPC 均不可用:\n  ' + errors.join('\n  '));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^\/\*\*?/, ''));
    return;
  }

  if (!['volume', 'cumulative'].includes(args.metric)) {
    throw new Error(`--metric 只能是 volume 或 cumulative，收到: ${args.metric}`);
  }

  const leaders = collectLeaders(args);
  if (leaders.length === 0) {
    throw new Error('未提供团队长地址。用 --leaders 0xAAA,0xBBB 或 --leaders-file leaders.txt');
  }

  const provider = await createProvider(args.rpc);
  const blockTag = args.block ?? (await provider.getBlockNumber());
  if (args.block) {
    const current = await provider.getBlockNumber();
    if (args.block > current) throw new Error(`--block ${args.block} 超过当前区块 ${current}`);
    if (current - args.block > 1000) {
      console.warn(`  ⚠️  快照区块距今 ${current - args.block} 个区块，公共 RPC 可能已剪枝，读取可能失败`);
    }
  }

  const contractAddress = args.contract || STAKING_BANK;
  if (!ethers.isAddress(contractAddress)) {
    throw new Error(`合约地址非法: ${contractAddress}`);
  }
  const code = await provider.getCode(contractAddress);
  if (code === '0x') {
    throw new Error(
      `地址 ${contractAddress} 上没有任何合约代码。\n` +
      `  请确认 RPC 指向正确的链（当前 RPC: ${provider._getConnection?.().url || '未知'}）`
    );
  }
  console.log(`质押合约: ${ethers.getAddress(contractAddress)}`);
  const contract = new ethers.Contract(contractAddress, ABI, provider);
  const cache = new Map();
  const fetchUser = createReader(contract, blockTag, cache);
  const getReferrals = (address) => getDirectReferrals(contract, address, blockTag);

  console.log(`团队长数量: ${leaders.length}`);
  console.log(`遍历深度: ${args.depth}   开始遍历…`);
  const startedAt = Date.now();

  const rows = [];
  for (const leader of leaders) {
    const report = await buildLeaderReport({
      leader,
      fetchUser,
      getReferrals,
      depth: args.depth,
      metric: args.metric,
      maxNodes: args.maxNodes,
    });
    rows.push(report);
    console.log(
      `  ✓ ${leader}  伞下 ${report.downlineCount} 人 / ${fmtEther(report.downlineVolume).toFixed(2)} ` +
      `${args.metric === 'cumulative' ? 'CON' : 'U'}`
    );
  }

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`遍历完成，用时 ${seconds}s，共读取 ${cache.size} 个地址`);

  printSummary(rows, args.metric, blockTag);

  if (args.csv) {
    const maxLevel = Math.min(
      args.levelCols,
      rows.reduce((m, r) => Math.max(m, r.levels.length), 0)
    );
    const csv = buildCsv(rows, args.metric, blockTag, maxLevel);
    const outPath = args.out || path.join(__dirname, `downline-report-${blockTag}.csv`);
    // 加 BOM，Excel 打开中文表头不乱码
    fs.writeFileSync(outPath, '﻿' + csv, 'utf8');
    console.log('');
    console.log(`CSV 已写入: ${outPath}`);
    if (maxLevel < rows.reduce((m, r) => Math.max(m, r.levels.length), 0)) {
      console.log(`注: 层级列只输出到 L${maxLevel}，更深层级已计入「伞下总业绩」`);
    }
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('');
    console.error('❌ 执行失败:', err.shortMessage || err.message);
    process.exit(1);
  });
}

module.exports = {
  buildLeaderReport,
  walkDownline,
  pickMetric,
  buildCsv,
  parseArgs,
  ABI,
  STAKING_BANK,
};
