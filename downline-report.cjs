#!/usr/bin/env node
/**
 * ============================================================
 *  CON 质押项目 —— 伞下业绩报表（只读脚本，不需要私钥）
 * ============================================================
 *  用途：合约只记录「直推」数据，没有伞下聚合。本脚本链下递归遍历推荐树，
 *        算出每个团队长的伞下总业绩与有效人数，供手工结算奖金使用。
 *
 *  用法：
 *    node downline-report.cjs 0x团队长地址
 *    node downline-report.cjs 0x地址1 0x地址2 0x地址3
 *    node downline-report.cjs 0x地址 --depth 5          # 只统计到第 5 代
 *    node downline-report.cjs 0x地址 --csv result.csv   # 同时导出 CSV
 *
 *  两个业绩口径（脚本都会输出，你按需要选）：
 *    累计业绩      = UserInfo.totalStaked      —— 只增不减，提取后仍计入
 *    当前有效业绩  = UserInfo.personalStakeVolume —— 提取会减少
 *
 *  ⚠️ 业绩随时在变，结算请记录脚本输出的「区块快照」号，保证可复现。
 * ============================================================
 */
const { ethers } = require('ethers');
const fs = require('fs');

const CONFIG = {
  rpc: process.env.BSC_RPC || 'https://rpc-bsc.48.club',
  chainId: 56,
  stakingBank: '0x0B3943E0851341164D859DB56B6502c786EC8000',
  concurrency: 8,      // 并发 RPC 数，被限流就调小
  pageSize: 200,       // getReferralsPaginated 每页条数
  maxAddresses: 50000, // 安全上限，防止误传入超大网络跑爆
};

const ABI = [
  'function getUserInfo(address user) view returns (tuple(uint256 totalStaked, uint256 totalWithdrawn, uint256 stakeCount, uint256 activeStakeCount, address referrer, uint256 directReferrals, uint256 referralStakeVolume, uint256 personalStakeVolume, uint256 pendingInviteRewards, uint256 totalInviteClaimed, uint256 lockedInviteRewards, uint256 inviteUnlockCursor) info, uint256 pendingRewards, uint256 totalClaimed, uint256 rank)',
  'function getReferralsPaginated(address user, uint256 offset, uint256 limit) view returns (address[] result, uint256 total)',
];

// ---------- 工具 ----------
const fmt = (v) => Number(ethers.formatEther(v)).toLocaleString('en-US', { maximumFractionDigits: 2 });
const short = (a) => `${a.slice(0, 6)}...${a.slice(-4)}`;

// 受限并发 map
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

// ---------- 链上读取 ----------
async function fetchAllReferrals(contract, addr) {
  const all = [];
  for (let offset = 0; ; offset += CONFIG.pageSize) {
    const page = await contract.getReferralsPaginated(addr, offset, CONFIG.pageSize);
    const list = page.result ?? page[0] ?? [];
    const total = Number(page.total ?? page[1] ?? 0);
    all.push(...list);
    if (list.length === 0 || all.length >= total) break;
  }
  return all;
}

async function fetchNode(contract, addr) {
  const [infoRes, refs] = await Promise.all([
    contract.getUserInfo(addr).catch(() => null),
    fetchAllReferrals(contract, addr).catch(() => []),
  ]);
  let info = null;
  if (infoRes) {
    const s = infoRes.info ?? infoRes[0];
    info = {
      totalStaked: s.totalStaked ?? s[0],
      personalStakeVolume: s.personalStakeVolume ?? s[7],
      referralStakeVolume: s.referralStakeVolume ?? s[6],
      directReferrals: Number(s.directReferrals ?? s[5] ?? 0),
    };
  }
  return { addr, info, refs };
}

// ---------- 遍历推荐树 ----------
async function walk(contract, root, maxDepth) {
  const seen = new Map();          // 小写地址 -> 原始地址
  seen.set(root.toLowerCase(), root);
  const infos = new Map();         // 小写地址 -> info
  const levels = [];               // levels[i] = 第 i+1 代的地址数组
  let frontier = [root];

  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const results = await mapLimit(frontier, CONFIG.concurrency, (a) => fetchNode(contract, a));
    const next = [];
    for (const r of results) {
      if (r.info) infos.set(r.addr.toLowerCase(), r.info);
      for (const child of r.refs) {
        const key = child.toLowerCase();
        if (seen.has(key)) continue;   // 合约本身禁止环路，这里双保险
        seen.set(key, child);
        next.push(child);
        if (seen.size > CONFIG.maxAddresses) {
          throw new Error(`伞下地址数超过 ${CONFIG.maxAddresses}，已中止。请用 --depth 限制层级。`);
        }
      }
    }
    if (next.length > 0) levels.push(next);   // 不推入空的末级
    frontier = next;
    if (next.length) process.stderr.write(`  已展开第 ${depth + 1} 代：${next.length} 人（累计 ${seen.size} 人）\n`);
  }
  return { levels, infos };
}

// ---------- 汇总 ----------
function aggregate(levels, infos) {
  const perLevel = [];
  let cum = 0n, active = 0n, people = 0, effective = 0;

  levels.forEach((addrs, idx) => {
    let lc = 0n, la = 0n, lp = 0, le = 0;
    for (const a of addrs) {
      const info = infos.get(a.toLowerCase());
      if (!info) { lp++; continue; }
      lc += info.totalStaked ?? 0n;
      la += info.personalStakeVolume ?? 0n;
      lp++;
      if ((info.personalStakeVolume ?? 0n) > 0n) le++;
    }
    perLevel.push({ level: idx + 1, people: lp, effective: le, cumulative: lc, active: la });
    cum += lc; active += la; people += lp; effective += le;
  });

  return { perLevel, cumulative: cum, active, people, effective };
}

// ---------- 输出 ----------
function printReport(root, agg, self, blockNumber, blockTime) {
  const L = '─'.repeat(64);
  console.log(`\n${'═'.repeat(64)}`);
  console.log(`团队长: ${root}`);
  console.log(`区块快照: #${blockNumber}   ${blockTime}`);
  console.log('═'.repeat(64));

  console.log('\n【伞下汇总】');
  console.log(`  伞下总人数        : ${agg.people.toLocaleString()} 人`);
  console.log(`  其中有效人数      : ${agg.effective.toLocaleString()} 人    (当前仍有有效质押)`);
  console.log(`  伞下累计业绩      : ${fmt(agg.cumulative)} U   (只增不减，提取后仍计入)`);
  console.log(`  伞下当前有效业绩  : ${fmt(agg.active)} U   (提取会减少)`);

  console.log('\n【按层级拆分】');
  if (agg.perLevel.length === 0) {
    console.log('  （伞下没有成员）');
  }
  for (const l of agg.perLevel) {
    console.log(
      `  第 ${String(l.level).padStart(2)} 代 : ` +
      `${String(l.people).padStart(5)} 人（有效 ${String(l.effective).padStart(5)}）   ` +
      `累计 ${fmt(l.cumulative).padStart(14)} U   ` +
      `当前有效 ${fmt(l.active).padStart(14)} U`
    );
  }
  if (agg.perLevel.length > 0) {
    console.log(`  ${L}`);
    console.log(
      `  合   计 : ` +
      `${String(agg.people).padStart(5)} 人（有效 ${String(agg.effective).padStart(5)}）   ` +
      `累计 ${fmt(agg.cumulative).padStart(14)} U   ` +
      `当前有效 ${fmt(agg.active).padStart(14)} U`
    );
  }

  if (self) {
    console.log('\n【团队长本人（不计入伞下）】');
    console.log(`  自身累计质押      : ${fmt(self.totalStaked)} U`);
    console.log(`  自身当前有效质押  : ${fmt(self.personalStakeVolume)} U`);
    console.log(`  直推人数          : ${self.directReferrals} 人`);
  }
}

// ---------- 主流程 ----------
async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    console.log(fs.readFileSync(__filename, 'utf8').split('* ============')[1]?.slice(3).split('const {')[0] || '');
    console.log('用法: node downline-report.cjs <团队长地址> [更多地址...] [--depth N] [--csv 文件]');
    return;
  }

  let depth = 20;
  let csvPath = null;
  const roots = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--depth') { depth = Number(argv[++i]); }
    else if (argv[i] === '--csv') { csvPath = argv[++i]; }
    else if (argv[i].startsWith('--')) { console.error('未知参数:', argv[i]); return; }
    else roots.push(argv[i]);
  }

  for (const r of roots) {
    if (!ethers.isAddress(r)) { console.error('❌ 无效地址:', r); return; }
  }
  if (roots.length === 0) { console.error('❌ 请至少提供一个团队长地址'); return; }

  const provider = new ethers.JsonRpcProvider(CONFIG.rpc, CONFIG.chainId, { staticNetwork: true });
  const contract = new ethers.Contract(CONFIG.stakingBank, ABI, provider);

  // 区块快照：保证本次结算可复现
  const blockNumber = await provider.getBlockNumber();
  const block = await provider.getBlock(blockNumber);
  const blockTime = new Date(block.timestamp * 1000).toLocaleString('zh-CN', { hour12: false });

  console.log(`RPC: ${CONFIG.rpc}`);
  console.log(`合约: ${CONFIG.stakingBank}`);
  console.log(`区块快照: #${blockNumber} (${blockTime})`);
  console.log(`最大层级: ${depth}`);

  const csvRows = [['团队长', '伞下总人数', '有效人数', '伞下累计业绩(U)', '伞下当前有效业绩(U)', '直推人数', '团队长累计质押(U)', '区块']];

  for (const root of roots) {
    console.log(`\n>>> 正在遍历 ${root} 的伞下…`);
    const { levels, infos } = await walk(contract, root, depth);
    const agg = aggregate(levels, infos);
    const self = infos.get(root.toLowerCase());
    printReport(root, agg, self, blockNumber, blockTime);

    csvRows.push([
      root,
      agg.people,
      agg.effective,
      ethers.formatEther(agg.cumulative),
      ethers.formatEther(agg.active),
      self?.directReferrals ?? 0,
      ethers.formatEther(self?.totalStaked ?? 0n),
      blockNumber,
    ]);
  }

  if (csvPath) {
    const csv = '﻿' + csvRows.map((r) => r.join(',')).join('\n');
    fs.writeFileSync(csvPath, csv);
    console.log(`\n✅ CSV 已导出: ${csvPath}`);
  }
}

if (require.main === module) {
  main().catch((e) => { console.error('执行失败:', e.shortMessage || e.message); process.exit(1); });
}

module.exports = { walk, aggregate, fetchAllReferrals, main, CONFIG };
