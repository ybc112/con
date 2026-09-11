/**
 * ============================================================
 *  CON 质押项目 —— 新链上部署 + 配置 + 注资 + 打底池 一键脚本
 * ============================================================
 *  已按对话确认的参数（不要随意改，改前先确认）：
 *    质押币 / 奖励币 : CON  0x66A585556138EbBb44Da0fF1324C796C44eb5ED1
 *    邀请奖励        : 100 CON/人（总供应 777 万，理论可发 ~7.7 万人）
 *    邀请达标门槛    : 100 U（固定汇率 1 CON = 1 U，不接价格源，底池价格不影响计分）
 *    交互费          : 0.00065118 BNB/笔（≈0.45U，构造时写入）
 *    合约储备        : 80 万 CON（50万邀请负债 + 20万奖池 + 10万缓冲），分 3 批注入
 *    底池            : 1 BNB + 6 万 CON  →  初始价 ≈ 0.01 U
 *
 *  执行前准备：
 *    1. 部署钱包至少持有：92 万 CON（6万池子 + 86万储备，储备分3批可后补）
 *       和 1.05+ BNB（1 BNB 底池 + 部署/交互 gas）
 *    2. 设置私钥环境变量，不要把私钥写进代码：
 *        PowerShell: $env:CON_DEPLOY_PRIVATE_KEY="0x..."
 *        CMD:        set CON_DEPLOY_PRIVATE_KEY=0x...
 *
 *  用法（按顺序，每步可单独跑）：
 *    node con-staking-deploy.cjs deploy    # 1. 部署质押合约（输出新合约地址）
 *    node con-staking-deploy.cjs config    # 2. 初始化参数：邀请奖励/门槛/汇率
 *    node con-staking-deploy.cjs fund      # 3. 向合约注入 80 万 CON 储备（分3批）
 *    node con-staking-deploy.cjs pool      # 4. 打底池：1 BNB + 6 万 CON
 *    node con-staking-deploy.cjs all       # 依次执行 1→4
 *    node con-staking-deploy.cjs status    # 只读：查看合约/钱包/储备/池子状态
 *    node con-staking-deploy.cjs setfee <新地址>   # 5. 部署后把交互费收币地址改成正式钱包
 * ============================================================
 */
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

// ---------------- 配置区（上线前请逐项核对） ----------------
const CONFIG = {
  rpc: 'https://bsc-rpc.publicnode.com',
  chainId: 56,
  conToken: '0x66A585556138EbBb44Da0fF1324C796C44eb5ED1',
  // 交互费收币地址 —— 注意：请改成你自己的新收币钱包（现在是占位沿用 CZ 项目的地址）
  feeReceiver: '0x5A378b61193ac2ce07cE816893C080804504a2f0',
  interactionFeeBnb: '0.00065118',          // 每笔交互费（BNB）
  inviteRewardCon: '100',                   // 邀请奖励 CON/人
  minReferralStakeValueU: '100',            // 邀请达标门槛（U）
  stakeValueRate: '1',                      // 固定汇率：1 CON = 1 U
  reserveBatchesCon: ['500000', '200000', '100000'], // 储备分批注入（共80万）
  poolBnb: '1',                             // 底池 BNB
  poolCon: '60000',                         // 底池 CON  → 1 BNB = 6万 CON
  pancakeRouter: '0x10ED43C718714eb63d5aA57B78B54704E256024E', // PancakeSwap V2 Router
};

const ARTIFACT = path.join(__dirname, 'artifacts', 'contracts', 'NBTStakingBankV3.sol', 'NBTStakingBankV3.json');
const OUTPUT = path.join(__dirname, 'con-staking-output.json');

function loadArtifact() {
  const j = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  return { abi: j.abi, bytecode: j.bytecode };
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(OUTPUT, 'utf8')); } catch { return {}; }
}
function saveState(s) { fs.writeFileSync(OUTPUT, JSON.stringify(s, null, 2)); }

async function getWallet() {
  const pk = process.env.CON_DEPLOY_PRIVATE_KEY;
  if (!pk) throw new Error('缺少私钥：请先设置环境变量 CON_DEPLOY_PRIVATE_KEY（不要把私钥写进脚本）');
  const provider = new ethers.JsonRpcProvider(CONFIG.rpc, CONFIG.chainId, { staticNetwork: true });
  const wallet = new ethers.Wallet(pk, provider);
  const net = await provider.getNetwork();
  if (net.chainId !== 56n) throw new Error('非 BSC 主网，chainId=' + net.chainId);
  return wallet;
}

const ERC20 = ['function balanceOf(address) view returns (uint256)', 'function approve(address,uint256) returns (bool)', 'function allowance(address,address) view returns (uint256)', 'function transfer(address,uint256) returns (bool)'];
const ROUTER = ['function addLiquidityETH(address,uint256,uint256,uint256,address,uint256) payable returns (uint256,uint256,uint256)'];
const BANK_VIEW = ['function stakingToken() view returns (address)', 'function rewardToken() view returns (address)', 'function feeReceiver() view returns (address)', 'function interactionFee() view returns (uint256)', 'function inviteReward() view returns (uint256)', 'function minReferralStakeValue() view returns (uint256)', 'function stakeValueRate() view returns (uint256)', 'function totalStaked() view returns (uint256)', 'function currentEpochId() view returns (uint256)'];

async function step_deploy(wallet, state) {
  if (state.stakingBank) { console.log('已存在合约地址:', state.stakingBank, '（跳过部署，如需重来请删除输出文件）'); return state; }
  const { abi, bytecode } = loadArtifact();
  const fee = ethers.parseEther(CONFIG.interactionFeeBnb);
  console.log('部署 NBTStakingBankV3 ...');
  console.log('  stakingToken/rewardToken:', CONFIG.conToken);
  console.log('  feeReceiver:', CONFIG.feeReceiver, '| 交互费:', CONFIG.interactionFeeBnb, 'BNB');
  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  const c = await factory.deploy(CONFIG.conToken, CONFIG.conToken, CONFIG.feeReceiver, fee, { gasLimit: 6000000 });
  const rc = await c.waitForDeployment();
  const addr = await rc.getAddress();
  console.log('  部署成功，合约地址:', addr, 'tx:', c.deploymentTransaction().hash);
  state.stakingBank = addr;
  saveState(state);
  return state;
}

async function step_config(wallet, state) {
  if (!state.stakingBank) throw new Error('尚未部署合约，先跑 deploy 步骤');
  const { abi } = loadArtifact();
  const bank = new ethers.Contract(state.stakingBank, abi, wallet);
  const invite = ethers.parseEther(CONFIG.inviteRewardCon);
  const minVal = ethers.parseEther(CONFIG.minReferralStakeValueU);
  const rate = ethers.parseEther(CONFIG.stakeValueRate);
  console.log('设置参数 ...');
  let tx = await bank.setInviteReward(invite, { gasLimit: 300000 });
  await tx.wait(); console.log('  setInviteReward(' + CONFIG.inviteRewardCon + ' CON) ok', tx.hash);
  tx = await bank.setMinReferralStakeValue(minVal, { gasLimit: 300000 });
  await tx.wait(); console.log('  setMinReferralStakeValue(' + CONFIG.minReferralStakeValueU + ' U) ok', tx.hash);
  tx = await bank.setStakeValueRate(rate, { gasLimit: 300000 });
  await tx.wait(); console.log('  setStakeValueRate(1 CON = 1 U) ok', tx.hash);
  return state;
}

async function step_fund(wallet, state) {
  if (!state.stakingBank) throw new Error('尚未部署合约，先跑 deploy 步骤');
  const { abi } = loadArtifact();
  const bank = new ethers.Contract(state.stakingBank, abi, wallet);
  const con = new ethers.Contract(CONFIG.conToken, ERC20, wallet);
  // 邀请奖励走独立储备入口（fundInvitePool），与排名奖池分离
  await con.approve(state.stakingBank, ethers.MaxUint256, { gasLimit: 300000 });
  for (const batch of CONFIG.reserveBatchesCon) {
    const amt = ethers.parseEther(batch);
    const bal = await con.balanceOf(wallet.address);
    if (bal < amt) throw new Error('钱包 CON 不足：需要 ' + batch + ' CON，当前 ' + ethers.formatEther(bal));
    const tx = await bank.fundInvitePool(amt, { gasLimit: 500000 });
    await tx.wait();
    console.log('  已注入邀请储备 ' + batch + ' CON，tx:', tx.hash);
    await new Promise((r) => setTimeout(r, 3000)); // 防连续交易限流
  }
  return state;
}

async function step_pool(wallet, state) {
  const con = new ethers.Contract(CONFIG.conToken, ERC20, wallet);
  const router = new ethers.Contract(CONFIG.pancakeRouter, ROUTER, wallet);
  const amtCon = ethers.parseEther(CONFIG.poolCon);
  const amtBnb = ethers.parseEther(CONFIG.poolBnb);
  const balCon = await con.balanceOf(wallet.address);
  const balBnb = await wallet.provider.getBalance(wallet.address);
  if (balCon < amtCon) throw new Error('钱包 CON 不足：需要 ' + CONFIG.poolCon + ' CON，当前 ' + ethers.formatEther(balCon));
  if (balBnb < amtBnb + ethers.parseEther('0.01')) throw new Error('钱包 BNB 不足：需要 ' + CONFIG.poolBnb + ' + gas');
  // 授权 CON 给 Router（只授本次所需额度，不授无限）
  const allow = await con.allowance(wallet.address, CONFIG.pancakeRouter);
  if (allow < amtCon) {
    const tx = await con.approve(CONFIG.pancakeRouter, amtCon, { gasLimit: 150000 });
    await tx.wait();
    console.log('  已授权 CON → PancakeSwap Router，tx:', tx.hash);
  }
  const deadline = Math.floor(Date.now() / 1000) + 600;
  console.log('添加流动性 1 BNB + ' + CONFIG.poolCon + ' CON ...');
  const tx = await router.addLiquidityETH(
    CONFIG.conToken, amtCon, 0, 0, wallet.address, deadline,
    { value: amtBnb, gasLimit: 500000 }
  );
  const rc = await tx.wait();
  console.log('  底池创建成功，tx:', tx.hash);
  console.log('  events:', rc.logs.length, '条日志（LP 已发放给', wallet.address, '）');
  return state;
}

async function step_setfee(wallet, state, newReceiver) {
  if (!state.stakingBank) throw new Error('尚未部署合约，先跑 deploy 步骤');
  if (!newReceiver || !ethers.isAddress(newReceiver)) throw new Error('请传入合法地址：node con-staking-deploy.cjs setfee 0x...');
  const { abi } = loadArtifact();
  const bank = new ethers.Contract(state.stakingBank, abi, wallet);
  const fee = ethers.parseEther(CONFIG.interactionFeeBnb);
  console.log('设置交互费收币地址:', newReceiver, '| 费用:', CONFIG.interactionFeeBnb, 'BNB（原生）');
  const tx = await bank.setInteractionFeeConfig(ZERO, fee, newReceiver, { gasLimit: 300000 });
  await tx.wait();
  console.log('  成功，tx:', tx.hash);
  const cfg = await bank.getInteractionFeeConfig();
  console.log('  当前配置 → feeToken:', cfg.feeToken, '| fee:', ethers.formatEther(cfg.fee), '| receiver:', cfg.receiverA);
  return state;
}

async function step_status(wallet) {
  const con = new ethers.Contract(CONFIG.conToken, ERC20, wallet);
  const state = loadState();
  console.log('钱包:', wallet.address);
  console.log('  BNB:', ethers.formatEther(await wallet.provider.getBalance(wallet.address)));
  console.log('  CON:', ethers.formatEther(await con.balanceOf(wallet.address)));
  if (state.stakingBank) {
    const bank = new ethers.Contract(state.stakingBank, BANK_VIEW, wallet);
    console.log('质押合约:', state.stakingBank);
    console.log('  合约 CON 余额:', ethers.formatEther(await con.balanceOf(state.stakingBank)));
    console.log('  stakingToken:', await bank.stakingToken());
    console.log('  rewardToken:', await bank.rewardToken());
    console.log('  feeReceiver:', await bank.feeReceiver());
    console.log('  interactionFee:', ethers.formatEther(await bank.interactionFee()), 'BNB');
    console.log('  inviteReward:', ethers.formatEther(await bank.inviteReward()), 'CON');
    console.log('  minReferralStakeValue:', ethers.formatEther(await bank.minReferralStakeValue()), 'U');
    console.log('  stakeValueRate:', ethers.formatEther(await bank.stakeValueRate()), '(1 CON = N U)');
    console.log('  totalStaked:', ethers.formatEther(await bank.totalStaked()));
    console.log('  currentEpochId:', (await bank.currentEpochId()).toString());
  } else {
    console.log('质押合约: 尚未部署');
  }
}

async function main() {
  const step = process.argv[2] || 'all';
  const wallet = await getWallet();
  const state = loadState();
  if (step === 'deploy') await step_deploy(wallet, state);
  else if (step === 'config') await step_config(wallet, state);
  else if (step === 'fund') await step_fund(wallet, state);
  else if (step === 'pool') await step_pool(wallet, state);
  else if (step === 'status') { await step_status(wallet); return; }
  else if (step === 'setfee') await step_setfee(wallet, state, process.argv[3]);
  else if (step === 'all') {
    await step_deploy(wallet, state);
    await step_config(wallet, state);
    await step_fund(wallet, state);
    await step_pool(wallet, state);
    console.log('\n全部完成！');
    console.log('新质押合约地址:', state.stakingBank);
    console.log('把这个地址填进前端 constants.js 的 STAKING_BANK，并把 NBT_TOKEN 换成', CONFIG.conToken);
  } else {
    console.log('未知步骤：', step, '（可用 deploy / config / fund / pool / all / status）');
  }
}

main().catch((e) => { console.error('错误:', e.shortMessage || e.message); process.exit(1); });
