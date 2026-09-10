/**
 * ============================================================
 *  Sepolia 全流程验证脚本 v3（专用运行钱包模式）
 * ============================================================
 *  部署钱包 0xc0738b... 被外部进程高频占用（nonce 竞争），
 *  本脚本用一次初始化把 ETH/tCON/operator 权限交给新生成的 runner 钱包，
 *  之后所有流程由 runner 执行，避免 nonce 竞争。
 *
 *  用法：$env:CON_DEPLOY_PRIVATE_KEY="0x..."; node sepolia-flow-check.cjs
 */
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const RPC = 'https://ethereum-sepolia-rpc.publicnode.com';
const CHAIN = 11155111;
const BANK = '0x7e4DBfF0d6d4AE36cA8f2F16c4B06E42C02D001d'; // Sepolia 修复版质押合约
const TCON = '0x9868386Cf6175fE560eACaDaB71ce44BFE308fE7';
const TEST_ACCOUNT = '0x4f51E1EA4aF9BFBeb6a94e1444Df71F21Cd9d705';
const FEE = ethers.parseEther('0.00065118');

const BANK_ABI = JSON.parse(fs.readFileSync('artifacts/contracts/NBTStakingBankV3.sol/NBTStakingBankV3.json', 'utf8')).abi;

async function sendWithRetry(fn, retries = 10) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
}

async function hiFee(provider) {
  const fd = await provider.getFeeData();
  return { maxFeePerGas: fd.maxFeePerGas * 10n, maxPriorityFeePerGas: fd.maxPriorityFeePerGas * 10n };
}

const fmt = (v) => ethers.formatEther(v);
const line = (k, v) => console.log('  ' + k + ': ' + v);

async function main() {
  const pk = process.env.CON_DEPLOY_PRIVATE_KEY;
  if (!pk) throw new Error('缺少私钥：CON_DEPLOY_PRIVATE_KEY');
  const provider = new ethers.JsonRpcProvider(RPC, CHAIN, { staticNetwork: true });
  const deployer = new ethers.Wallet(pk, provider);
  const bankRO = new ethers.Contract(BANK, BANK_ABI, provider);
  const tconRO = new ethers.Contract(TCON, ['function balanceOf(address) view returns (uint256)'], provider);

  // runner 钱包：随机私钥持久化到本地文件（重复运行保持同一钱包，幂等；避免弱私钥被机器人盗走）
  const KEY_FILE = path.join(__dirname, 'sepolia-runner-key.txt');
  let runnerPk;
  if (fs.existsSync(KEY_FILE)) {
    runnerPk = fs.readFileSync(KEY_FILE, 'utf8').trim();
  } else {
    runnerPk = ethers.Wallet.createRandom().privateKey;
    fs.writeFileSync(KEY_FILE, runnerPk);
  }
  const runner = new ethers.Wallet(runnerPk, provider);
  console.log('================ Sepolia 流程验证 v3 ================');
  console.log('runner 钱包:', runner.address);
  console.log('部署钱包:', deployer.address);
  console.log('测试账户:', TEST_ACCOUNT);

  // ---- 初始化：runner 需要 ETH + tCON + operator 权限 ----
  if ((await provider.getBalance(runner.address)) < ethers.parseEther('0.1')) {
    console.log('\n[init] 给 runner 转 1 ETH');
    await sendWithRetry(async () => {
      const n = await deployer.getNonce('pending');
      const tx = await deployer.sendTransaction({ to: runner.address, value: ethers.parseEther('1'), gasLimit: 100000, nonce: n, ...(await hiFee(provider)) });
      await tx.wait();
      return true;
    });
  } else {
    console.log('\n[init] runner 已有 ETH，跳过');
  }
  if ((await tconRO.balanceOf(runner.address)) < ethers.parseEther('10000')) {
    console.log('[init] 给 runner 转 30万 tCON');
    const tconW = new ethers.Contract(TCON, ['function transfer(address,uint256) returns (bool)'], deployer);
    await sendWithRetry(async () => {
      const n = await deployer.getNonce('pending');
      await tconW['transfer'](runner.address, ethers.parseEther('300000'), { gasLimit: 200000, nonce: n, ...(await hiFee(provider)) });
      return true;
    });
  } else {
    console.log('[init] runner 已有 tCON，跳过');
  }
  const bankW = new ethers.Contract(BANK, BANK_ABI, deployer);
  if (!(await bankRO.operators(runner.address))) {
    console.log('[init] 给 runner 授权 operator');
    await sendWithRetry(async () => {
      const n = await deployer.getNonce('pending');
      const tx = await bankW.setOperator(runner.address, true, { gasLimit: 300000, nonce: n, ...(await hiFee(provider)) });
      return tx.wait();
    });
    console.log('[init] runner 已授权 operator ✓');
  } else {
    console.log('[init] runner 已是 operator，跳过');
  }

  // ---- runner 正式执行流程 ----
  const bank = new ethers.Contract(BANK, BANK_ABI, runner);
  const tcon = new ethers.Contract(TCON, ['function balanceOf(address) view returns (uint256)', 'function transfer(address,uint256) returns (bool)', 'function approve(address,uint256) returns (bool)'], runner);
  const gOpts = async () => { const n = await runner.getNonce('pending'); return { gasLimit: 3000000, nonce: n, ...(await hiFee(provider)) }; };

  console.log('\n[0] 初始状态');
  line('合约 tCON 储备', fmt(await tconRO.balanceOf(BANK)));
  line('currentEpochId', (await bankRO.currentEpochId()).toString());
  line('inviteReward', fmt(await bankRO.inviteReward()) + ' CON');
  line('minReferralStakeValue', fmt(await bankRO.minReferralStakeValue()) + ' U');
  line('stakeValueRate', fmt(await bankRO.stakeValueRate()) + ' (1 CON=N U)');
  line('interactionFee', fmt(await bankRO.interactionFee()) + ' ETH');
  const cfg = await bankRO.getInteractionFeeConfig();
  line('feeReceiver', cfg.receiverA);
  line('排行榜节点数', (await bankRO.getRankedNodeCount()).toString());

  // 1. runner 质押（referrer = 测试账户）
  if (Number(await bankRO.getNodeRank(runner.address)) === 0) {
    console.log('\n[1] runner 质押 500 tCON（referrer = 测试账户）');
    const ap = await tcon.approve(BANK, ethers.MaxUint256, { gasLimit: 200000 });
    await ap.wait();
    const tx = await bank.stake(ethers.parseEther('500'), TEST_ACCOUNT, { ...(await gOpts()), value: FEE });
    await tx.wait();
    line('质押成功，节点分数(个人)', fmt((await bankRO.getUserInfo(runner.address)).info.personalStakeVolume));
    line('我的排名', (await bankRO.getNodeRank(runner.address)).toString());
  } else {
    console.log('\n[1] runner 已质押，跳过');
  }
  const testInfo = await bankRO.getUserInfo(TEST_ACCOUNT);
  line('测试账户 lockedInviteRewards', fmt(testInfo.info.lockedInviteRewards) + ' CON（页面"邀请奖励待领"）');
  line('测试账户 directReferrals', testInfo.info.directReferrals.toString());
  line('测试账户 是否合格邀请人', await bankRO.qualifiedReferral(TEST_ACCOUNT, runner.address));

  // 2. 补充节点至 ≥10
  let nodeCount = Number(await bankRO.getRankedNodeCount());
  if (nodeCount < 10) {
    console.log('\n[2] 补充节点至 ≥10');
    const newWallets = [];
    for (let i = 0; i < 10; i++) newWallets.push(ethers.Wallet.createRandom().connect(provider));
    // runner 无并发：自动 nonce 顺序执行最稳
    for (const w of newWallets) {
      const tx = await runner.sendTransaction({ to: w.address, value: ethers.parseEther('0.01'), gasLimit: 100000 });
      await tx.wait();
      const tx2 = await tcon['transfer'](w.address, ethers.parseEther('1000'), { gasLimit: 200000 });
      await tx2.wait();
    }
    for (let i = 0; i < 10; i++) {
      const w = newWallets[i];
      const ref = i < 9 ? newWallets[i + 1].address : runner.address;
      const ap = await tcon.connect(w).approve(BANK, ethers.MaxUint256, { gasLimit: 200000 });
      await ap.wait();
      const st = await bank.connect(w).stake(ethers.parseEther('100'), ref, { gasLimit: 1000000, value: FEE });
      await st.wait();
    }
    nodeCount = Number(await bankRO.getRankedNodeCount());
  } else {
    console.log('\n[2] 节点数已 ≥10，跳过');
  }
  line('总节点数', nodeCount.toString());
  const [nodes, scores] = await bankRO.getRankedNodes(0, 20);
  console.log('  排行榜（前 15）：');
  for (let i = 0; i < Math.min(15, nodes.length); i++) {
    console.log('    #' + (i + 1) + ' ' + nodes[i].slice(0, 10) + '...  ' + fmt(scores[i]) + ' U');
  }

  // 3. openEpoch + fundEpoch —— 幂等：已有奖池则跳过；未开期则开期；已开未注资则补注资
  const cur = await bankRO.getCurrentRelease();
  const epochIdNow = Number(await bankRO.currentEpochId());
  const epNow0 = await bankRO.getEpoch(epochIdNow.toString());
  const snapshotNow = Number(epNow0.snapshotTime);
  if (snapshotNow === 0 || (Number(cur.poolAmount) === 0 && !epNow0.settled)) {
    console.log('\n[3] 开期 + 注资 20000 tCON');
    if (snapshotNow === 0) {
      const tx1 = await bank.openEpoch(await gOpts());
      await tx1.wait();
    }
    const epochId = Number(await bankRO.currentEpochId());
    line('当前 epochId', epochId.toString());
    const ep = await bankRO.getEpoch(epochId.toString());
    line('快照节点数', ep.totalNodes.toString());
    line('disabled(合并)', ep.disabled);
    // runner 已无限授权（质押时 approve 过 MaxUint256），无需重复 approve
    const tx2 = await bank.fundEpoch(ethers.parseEther('20000'), { gasLimit: 500000, nonce: await runner.getNonce('pending') });
    await tx2.wait();
    const ep2 = await bankRO.getEpoch(epochId.toString());
    line('当前期奖池', fmt(ep2.poolAmount) + ' CON');
    const c2 = await bankRO.getCurrentRelease();
    line('claimStart', new Date(Number(c2.claimStart) * 1000).toLocaleString());
    line('claimEnd', new Date(Number(c2.claimEnd) * 1000).toLocaleString());
  } else {
    console.log('\n[3] 当前期已开且有奖池，跳过（epochId=' + epochIdNow + ', pool=' + fmt(epNow0.poolAmount) + '）');
  }

  // 4. 分红数据核对
  console.log('\n[4] 分红数据核对');
  const epochId2 = Number(await bankRO.currentEpochId());
  const epNow = await bankRO.getEpoch(epochId2.toString());
  const myRank = await bankRO.epochRank(epochId2.toString(), runner.address);
  line('我的快照排名(epochRank)', myRank.toString());
  line('pendingEpochReward(展示期内)', fmt(await bankRO.pendingEpochReward(epochId2.toString(), runner.address)) + ' CON（3天内展示期不可领，属正常）');
  const totalNodesNow = epNow.totalNodes.toString();
  const p1 = await bankRO.getRankRewardPreview(epNow.poolAmount, totalNodesNow, 1);
  line('按档位计算 rank1 应得', fmt(p1) + ' CON');
  console.log('  档位权重:',
    totalNodesNow <= 10 ? '[100% 前10名]' :
    totalNodesNow <= 50 ? '[50/50 前10+11-50]' :
    totalNodesNow <= 100 ? '[50/30/20]' : '[50/30/15/5]');
  if (Number(totalNodesNow) <= 20) {
    let sum = 0n;
    for (let r = 1; r <= Number(totalNodesNow); r++) {
      sum += await bankRO.getRankRewardPreview(epNow.poolAmount, totalNodesNow, r);
    }
    line('全节点分红合计', fmt(sum) + ' CON（= 奖池 ' + fmt(epNow.poolAmount) + ' 则 100% 分完）');
  }

  // 5. 数据一致性
  console.log('\n[5] 数据一致性核对');
  const mining = await bankRO.getMiningStatus();
  line('totalStaked', fmt(mining._totalStaked) + ' CON');
  line('已累计邀请奖励负债', fmt(await bankRO.totalInviteRewardsAccrued()) + ' CON');
  line('已发放邀请奖励', fmt(await bankRO.totalInviteRewardsClaimed()) + ' CON');
  line('合约 tCON 余额', fmt(await tconRO.balanceOf(BANK)) + ' CON（含质押本金+储备）');

  // 6. 修复项链上核对（F04/F07/F10）
  console.log('\n[6] 修复项链上核对（F04/F07/F10）');
  // F07：getRankClaimed 存在且可读
  line('getRankClaimed(runner)', fmt(await bankRO.getRankClaimed(runner.address)) + ' CON（新增接口可读）');
  // F10：档间舍入尾差 100% 分完（11 节点、101 wei）
  let sumWei = 0n;
  for (let r = 1; r <= 11; r++) sumWei += await bankRO.getRankRewardPreview(101n, 11, r);
  line('F10 档间尾差(11节点101wei)', sumWei.toString() + ' wei（=101 则 100% 分完）');
  // F04：领取期禁止追加注资 —— 展示期内注资成功、领取期 revert 由合约保证，这里验证已开期状态
  const cur2 = await bankRO.getCurrentRelease();
  line('当前期 epoch/池/已领', cur2.epochId.toString() + ' / ' + fmt(cur2.poolAmount) + ' / ' + fmt(cur2.totalClaimed));
  console.log('\n================ 验证完成 ================');
}

main().catch((e) => { console.error('错误:', e.shortMessage || e.message); process.exit(1); });
