#!/usr/bin/env node
/**
 * ============================================================
 *  CON 质押项目 —— 团队长伞下业绩结算脚本（只读，不需要私钥）
 * ============================================================
 *  背景：合约只记录「直推（第一代）」数据（referralStakeVolume / directReferrals），
 *        没有任何伞下聚合函数。本脚本链下递归遍历推荐树，算出每个团队长的伞下总业绩，
 *        用于按业绩额外结算团队奖金。
 *
 *  数据来源（全部为链上只读调用）：
 *    getUserInfo(address)                  → 本人业绩、直推人数、直推业绩
 *    getReferralsPaginated(address,o,l)    → 某地址的直推列表（分页）
 *
 *  用法：
 *    node con-downline-report.cjs --leaders 0xAAA,0xBBB
 *    node con-downline-report.cjs --leaders-file leaders.txt --depth 5
 *    node con-downline-report.cjs --leaders 0xAAA --out report.csv
 *
 *  参数：
 *    --leaders <a,b,c>       团队长地址，逗号分隔
 *    --leaders-file <path>   团队长地址文件（每行一个，# 开头为注释）
 *    --depth <n>             遍历深度，默认 20（合约 MAX_REFERRAL_DEPTH 上限）
 *    --block <n>             快照区块，默认取脚本启动时的最新区块
 *    --rpc <url>             自定义 RPC
 *    --contract <address>    质押合约地址，默认主网 0x0B3943...C8000
 *    --out <path>            输出 CSV 路径，默认 downline-report-<区块>.csv
 *    --level-cols <n>        每个层级单独输出的列数，默认 10（超出部分仍计入总计）
 *    --max-nodes <n>         遍历节点数安全上限，默认 50000
 *    --no-csv                只打印汇总表，不写文件
 *
 *  ⚠️ 两个业绩口径，脚本同时输出，你按奖金规则选用：
 *      累计业绩      = UserInfo.totalStaked        —— 只增不减，提取后仍计入
 *      当前有效业绩  = UserInfo.personalStakeVolume —— 提取会减少
 *     团队长在自己页面上看到的「邀请质押价值」是【当前有效】口径。
 *     若按【累计】结算，团队长看到的数字会比结算数字小，务必提前说明。
 *
 *  ⚠️ 业绩随时在变，脚本默认按启动时的区块固定快照，保证同样的参数可复现。
 *     重新结算请核对输出里的「快照区块」是否与上次一致。
 * ============================================================
 */
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

// ---------------- 配置 ----------------
const STAKING_BANK = '0x0B3943E0851341164D859DB56B6502c786EC8000';
const RPC_FALLBACKS = [
  'https://rpc-bsc.48.club',
  'https://bsc.publicnode.com',
  'https://bsc-dataseed.binance.org/',
];

// 只声明用得到的接口。getUserInfo 返回的是合约里的 UserInfo 结构体，
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

/** 带重试的 RPC 调用。失败会抛出而不是静默返回 0——结算脚本少算钱必须暴露出来 */
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

const fmtNum = (v) => Number(ethers.formatEther(v));
const fmtDisplay = (v) => Number(ethers.formatEther(v)).toLocaleString('en-US', { maximumFractionDigits: 2 });
const shortAddr = (a) => `${a.slice(0, 10)}...${a.slice(-8)}`;

// ---------------- 链上读取 ----------------

/** 读取单个地址的信息，带缓存 */
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
    if (page.length === 0 || all.length >= Number(total)) break;
    offset += page.length;
  }
  return all;
}

/**
 * 遍历某团队长的伞下树（BFS，逐层）。
 * 每层统计：人数、有效人数、累计业绩、当前有效业绩。不含团队长本人。
 */
async function walkDownline({ fetchUser, getReferrals, leader, depth, maxNodes, onProgress }) {
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
      throw new Error(`伞下节点数超过安全上限 ${maxNodes}，已中止。可调大 --max-nodes 或调小 --depth`);
    }

    // 关键：本层所有人的 info 必须在本层内取齐，不能被 depth 截断
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
    if (onProgress) onProgress(d, next.length, visited.size + 1);
    frontier = next;
  }

  return levels;
}

/** 生成一个团队长的完整报告。独立导出，便于用 mock 合约做单元测试。 */
async function buildLeaderReport({ leader, fetchUser, getReferrals, depth, maxNodes, onProgress }) {
  const self = await fetchUser(leader);
  const levels = await walkDownline({ fetchUser, getReferrals, leader, depth, maxNodes, onProgress });

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

// ---------------- 参数解析 ----------------

function parseArgs(argv) {
  const args = {
    leaders: '',
    leadersFile: '',
    depth: 20,
    block: null,
    rpc: '',
    contract: '',
    out: '',
    levelCols: 10,
    maxNodes: 50000,
    csv: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--leaders') args.leaders = next();
    else if (a === '--leaders-file') args.leadersFile = next();
    else if (a === '--depth') args.depth = Number(next());
    else if (a === '--block') args.block = Number(next());
    else if (a === '--rpc') args.rpc = next();
    else if (a === '--contract') args.contract = next();
    else if (a === '--out') args.out = next();
    else if (a === '--level-cols') args.levelCols = Number(next());
    else if (a === '--max-nodes') args.maxNodes = Number(next());
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

function buildCsv(rows, block, maxLevelShown) {
  const headers = ['团队长地址', '伞下总人数', '伞下有效人数', '伞下累计业绩', '伞下当前有效业绩'];
  for (let d = 1; d <= maxLevelShown; d++) {
    headers.push(`L${d}人数`, `L${d}有效人数`, `L${d}累计业绩`, `L${d}当前有效业绩`);
  }
  headers.push('直推人数', '直推累计业绩', '直推当前有效业绩', '本人累计质押', '本人当前有效', '快照区块');

  const lines = [headers.join(',')];
  for (const r of rows) {
    const cells = [
      r.address,
      r.downlineCount,
      r.downlineActiveCount,
      fmtNum(r.downlineCumulative).toFixed(4),
      fmtNum(r.downlineActive).toFixed(4),
    ];
    for (let d = 1; d <= maxLevelShown; d++) {
      const lv = r.levels.find((l) => l.depth === d);
      cells.push(
        lv ? lv.count : 0,
        lv ? lv.activeCount : 0,
        lv ? fmtNum(lv.cumulative).toFixed(4) : '0.0000',
        lv ? fmtNum(lv.active).toFixed(4) : '0.0000'
      );
    }
    cells.push(
      r.directCount,
      fmtNum(r.directCumulative).toFixed(4),
      fmtNum(r.directActive).toFixed(4),
      fmtNum(r.selfCumulative).toFixed(4),
      fmtNum(r.selfActive).toFixed(4),
      block
    );
    lines.push(cells.join(','));
  }
  return lines.join('\n');
}

function printSummary(rows, block) {
  const line = '─'.repeat(78);
  console.log('');
  console.log('═'.repeat(78));
  console.log(`快照区块: #${block}   （业绩随时在变，重新结算请核对此区块号是否一致）`);
  console.log('═'.repeat(78));

  // 总表
  console.log(
    '团队长'.padEnd(26) +
    '伞下人数'.padStart(10) +
    '累计业绩'.padStart(18) +
    '当前有效业绩'.padStart(20)
  );
  console.log(line);
  for (const r of rows) {
    console.log(
      shortAddr(r.address).padEnd(26) +
      String(r.downlineCount).padStart(10) +
      fmtDisplay(r.downlineCumulative).padStart(18) +
      fmtDisplay(r.downlineActive).padStart(20)
    );
  }
  console.log(line);
  const totalCum = rows.reduce((s, r) => s + r.downlineCumulative, 0n);
  const totalAct = rows.reduce((s, r) => s + r.downlineActive, 0n);
  console.log(
    '合计'.padEnd(26) +
    String(rows.reduce((s, r) => s + r.downlineCount, 0)).padStart(10) +
    fmtDisplay(totalCum).padStart(18) +
    fmtDisplay(totalAct).padStart(20)
  );

  // 逐人明细
  for (const r of rows) {
    console.log('');
    console.log(`${'━'.repeat(78)}`);
    console.log(`团队长: ${r.address}`);
    console.log('');
    console.log('【伞下汇总】（不含团队长本人）');
    console.log(`  伞下总人数        : ${r.downlineCount.toLocaleString()} 人`);
    console.log(`  其中有效人数      : ${r.downlineActiveCount.toLocaleString()} 人    (当前仍有有效质押)`);
    console.log(`  伞下累计业绩      : ${fmtDisplay(r.downlineCumulative)}   (只增不减，提取后仍计入)`);
    console.log(`  伞下当前有效业绩  : ${fmtDisplay(r.downlineActive)}   (提取会减少)`);

    console.log('');
    console.log('【按层级拆分】');
    if (r.levels.length === 0) {
      console.log('  （伞下没有成员）');
    } else {
      for (const l of r.levels) {
        console.log(
          `  第 ${String(l.depth).padStart(2)} 代 : ` +
          `${String(l.count).padStart(5)} 人（有效 ${String(l.activeCount).padStart(5)}）   ` +
          `累计 ${fmtDisplay(l.cumulative).padStart(16)}   当前有效 ${fmtDisplay(l.active).padStart(16)}`
        );
      }
      console.log(`  ${line}`);
      console.log(
        `  合   计 : ` +
        `${String(r.downlineCount).padStart(5)} 人（有效 ${String(r.downlineActiveCount).padStart(5)}）   ` +
        `累计 ${fmtDisplay(r.downlineCumulative).padStart(16)}   当前有效 ${fmtDisplay(r.downlineActive).padStart(16)}`
      );
    }

    console.log('');
    console.log('【团队长本人】（不计入伞下）');
    console.log(`  自身累计质押      : ${fmtDisplay(r.selfCumulative)}`);
    console.log(`  自身当前有效质押  : ${fmtDisplay(r.selfActive)}`);
    console.log(`  直推人数          : ${r.selfDirectReferrals} 人`);
    console.log(`  直推当前有效业绩  : ${fmtDisplay(r.selfReferralVolume)}   (合约记录的 referralStakeVolume)`);
  }
  console.log('');
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
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^#!.*\n/, ''));
    return;
  }

  if (!Number.isInteger(args.depth) || args.depth < 1) {
    throw new Error(`--depth 必须是正整数，收到: ${args.depth}`);
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
    throw new Error(`地址 ${contractAddress} 上没有任何合约代码，请确认 RPC 指向正确的链`);
  }
  console.log(`质押合约: ${ethers.getAddress(contractAddress)}`);
  console.log(`快照区块: #${blockTag}`);
  console.log(`团队长数量: ${leaders.length}   遍历深度: ${args.depth}`);

  const contract = new ethers.Contract(contractAddress, ABI, provider);
  const cache = new Map();
  const fetchUser = createReader(contract, blockTag, cache);
  const getReferrals = (address) => getDirectReferrals(contract, address, blockTag);

  const startedAt = Date.now();
  const rows = [];
  for (const leader of leaders) {
    const report = await buildLeaderReport({
      leader,
      fetchUser,
      getReferrals,
      depth: args.depth,
      maxNodes: args.maxNodes,
      onProgress: (d, n, total) =>
        process.stderr.write(`    已展开第 ${d} 代：${n} 人（累计 ${total} 人）\n`),
    });
    rows.push(report);
  }
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`遍历完成，用时 ${seconds}s，共读取 ${cache.size} 个地址`);

  printSummary(rows, blockTag);

  if (args.csv) {
    const deepest = rows.reduce((m, r) => Math.max(m, r.levels.length), 0);
    const maxLevel = Math.min(args.levelCols, deepest);
    const csv = buildCsv(rows, blockTag, maxLevel);
    const outPath = args.out || path.join(__dirname, `downline-report-${blockTag}.csv`);
    // 加 BOM，Excel 打开中文表头不乱码
    fs.writeFileSync(outPath, '﻿' + csv, 'utf8');
    console.log(`CSV 已写入: ${outPath}`);
    if (maxLevel < deepest) {
      console.log(`注: 层级列只输出到 L${maxLevel}，更深层级已计入「伞下总计」`);
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
  buildCsv,
  parseArgs,
  ABI,
  STAKING_BANK,
};
