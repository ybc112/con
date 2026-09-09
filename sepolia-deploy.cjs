/**
 * ============================================================
 *  CON 质押项目 —— Sepolia 测试网部署脚本（测试用）
 * ============================================================
 *  测试网参数（与主网逻辑一致，仅网络/地址不同）：
 *    质押币/奖励币 : 新部署的测试 CON（tCON）
 *    邀请奖励      : 100 tCON/人
 *    邀请达标门槛  : 100 U（固定汇率 1 tCON = 1 U）
 *    交互费        : 0.00065118 ETH/笔（构造时写入）
 *    合约储备      : 80 万 tCON（分 3 批注入）
 *    底池          : 0.1 ETH + 6 万 tCON（Sepolia Uniswap V2）
 *
 *  用法（按顺序，每步可单独跑）：
 *    node sepolia-deploy.cjs deploy   # 1. 部署测试 CON + 质押合约
 *    node sepolia-deploy.cjs config   # 2. 初始化参数：邀请奖励/门槛/汇率
 *    node sepolia-deploy.cjs fund     # 3. 向合约注入 80 万 tCON 储备（分3批）
 *    node sepolia-deploy.cjs pool     # 4. Uniswap V2 打底池：0.1 ETH + 6 万 tCON
 *    node sepolia-deploy.cjs all      # 依次执行 1→4
 *    node sepolia-deploy.cjs status   # 只读：查看合约/钱包/储备/池子状态
 * ============================================================
 */
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

// ---------------- 配置区（测试网可调整） ----------------
const CONFIG = {
  rpc: 'https://ethereum-sepolia-rpc.publicnode.com',
  chainId: 11155111,
  // 交互费收币地址 —— 测试网沿用占位，主网部署前请改成正式钱包
  feeReceiver: '0x5A378b61193ac2ce07cE816893C080804504a2f0',
  interactionFeeEth: '0.00065118',       // 每笔交互费（ETH）
  inviteRewardCon: '100',                // 邀请奖励 CON/人
  minReferralStakeValueU: '100',         // 邀请达标门槛（U）
  stakeValueRate: '1',                   // 固定汇率：1 CON = 1 U
  testConInitialSupply: '20000000',      // 测试 CON 初始铸造：2000 万
  reserveBatchesCon: ['500000', '200000', '100000'], // 储备分批注入（共80万）
  poolEth: '0.1',                        // 底池 ETH（测试网）
  poolCon: '60000',                      // 底池 CON  → 1 ETH = 60万 CON
  uniswapRouter: '0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3', // Sepolia Uniswap V2 Router
};

const BANK_ARTIFACT = path.join(__dirname, 'artifacts', 'contracts', 'NBTStakingBankV3.sol', 'NBTStakingBankV3.json');
const CON_ARTIFACT = path.join(__dirname, 'artifacts', 'contracts', 'TestCON.sol', 'TestCON.json');
const OUTPUT = path.join(__dirname, 'sepolia-output.json');

function loadArtifact(p) {
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
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
  if (net.chainId !== 11155111n) throw new Error('非 Sepolia 网络，chainId=' + net.chainId);
  return wallet;
}

const ERC20 = ['function balanceOf(address) view returns (uint256)', 'function approve(address,uint256) returns (bool)', 'function allowance(address,address) view returns (uint256)'];
const ROUTER = ['function addLiquidityETH(address,uint256,uint256,uint256,address,uint256) payable returns (uint256,uint256,uint256)'];
const BANK_VIEW = ['function stakingToken() view returns (address)', 'function rewardToken() view returns (address)', 'function feeReceiver() view returns (address)', 'function interactionFee() view returns (uint256)', 'function inviteReward() view returns (uint256)', 'function minReferralStakeValue() view returns (uint256)', 'function stakeValueRate() view returns (uint256)', 'function totalStaked() view returns (uint256)', 'function currentEpochId() view returns (uint256)'];

async function step_deploy(wallet, state) {
  if (state.stakingBank) { console.log('已存在质押合约地址:', state.stakingBank, '（跳过部署，如需重来请删除输出文件）'); return state; }
  const bankArt = loadArtifact(BANK_ARTIFACT);
  const conArt = loadArtifact(CON_ARTIFACT);

  // 1. 部署测试 CON
  if (!state.testCon) {
    console.log('部署测试 CON（tCON）...');
    const initial = ethers.parseEther(CONFIG.testConInitialSupply);
    const cf = new ethers.ContractFactory(conArt.abi, conArt.bytecode, wallet);
    const c = await cf.deploy(initial, { gasLimit: 3000000 });
    await c.waitForDeployment();
    state.testCon = await c.getAddress();
    console.log('  tCON:', state.testCon, 'tx:', c.deploymentTransaction().hash);
    saveState(state);
  } else {
    console.log('tCON 已存在:', state.testCon);
  }

  // 2. 部署质押合约
  const fee = ethers.parseEther(CONFIG.interactionFeeEth);
  console.log('部署 NBTStakingBankV3 ...');
  console.log('  stakingToken/rewardToken:', state.testCon);
  console.log('  feeReceiver:', CONFIG.feeReceiver, '| 交互费:', CONFIG.interactionFeeEth, 'ETH');
  const factory = new ethers.ContractFactory(bankArt.abi, bankArt.bytecode, wallet);
  const c = await factory.deploy(state.testCon, state.testCon, CONFIG.feeReceiver, fee, { gasLimit: 4000000 });
  const rc = await c.waitForDeployment();
  const addr = await rc.getAddress();
  console.log('  部署成功，质押合约地址:', addr, 'tx:', c.deploymentTransaction().hash);
  state.stakingBank = addr;
  saveState(state);
  return state;
}

async function step_config(wallet, state) {
  if (!state.stakingBank) throw new Error('尚未部署合约，先跑 deploy 步骤');
  const { abi } = loadArtifact(BANK_ARTIFACT);
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
  if (!state.testCon) throw new Error('缺少测试 CON 地址，先跑 deploy 步骤');
  const con = new ethers.Contract(state.testCon, ERC20, wallet);
  for (const batch of CONFIG.reserveBatchesCon) {
    const amt = ethers.parseEther(batch);
    const bal = await con.balanceOf(wallet.address);
    if (bal < amt) throw new Error('钱包 tCON 不足：需要 ' + batch + ' CON，当前 ' + ethers.formatEther(bal));
    const tx = await con.transfer(state.stakingBank, amt, { gasLimit: 300000 });
    await tx.wait();
    console.log('  已注入 ' + batch + ' tCON → 合约，tx:', tx.hash);
    await new Promise((r) => setTimeout(r, 3000)); // 防连续交易限流
  }
  return state;
}

async function step_pool(wallet, state) {
  if (!state.stakingBank) throw new Error('尚未部署合约，先跑 deploy 步骤');
  if (!state.testCon) throw new Error('缺少测试 CON 地址，先跑 deploy 步骤');
  const con = new ethers.Contract(state.testCon, ERC20, wallet);
  const router = new ethers.Contract(CONFIG.uniswapRouter, ROUTER, wallet);
  const amtCon = ethers.parseEther(CONFIG.poolCon);
  const amtEth = ethers.parseEther(CONFIG.poolEth);
  const balCon = await con.balanceOf(wallet.address);
  const balEth = await wallet.provider.getBalance(wallet.address);
  if (balCon < amtCon) throw new Error('钱包 tCON 不足：需要 ' + CONFIG.poolCon + ' CON，当前 ' + ethers.formatEther(balCon));
  if (balEth < amtEth + ethers.parseEther('0.02')) throw new Error('钱包 ETH 不足：需要 ' + CONFIG.poolEth + ' + gas');
  // 授权 tCON 给 Router（只授本次所需额度，不授无限）
  const allow = await con.allowance(wallet.address, CONFIG.uniswapRouter);
  if (allow < amtCon) {
    const tx = await con.approve(CONFIG.uniswapRouter, amtCon, { gasLimit: 150000 });
    await tx.wait();
    console.log('  已授权 tCON → Uniswap Router，tx:', tx.hash);
  }
  const deadline = Math.floor(Date.now() / 1000) + 600;
  console.log('添加流动性 ' + CONFIG.poolEth + ' ETH + ' + CONFIG.poolCon + ' tCON ...');
  const tx = await router.addLiquidityETH(
    state.testCon, amtCon, 0, 0, wallet.address, deadline,
    { value: amtEth, gasLimit: 500000 }
  );
  await tx.wait();
  console.log('  底池创建成功，tx:', tx.hash);
  console.log('  提示：测试网价格仅为验证流程用，主网上线按 1 BNB = 6 万 CON 重新打池');
  return state;
}

async function step_status(wallet) {
  const state = loadState();
  console.log('钱包:', wallet.address);
  console.log('  ETH:', ethers.formatEther(await wallet.provider.getBalance(wallet.address)));
  if (state.testCon) {
    const con = new ethers.Contract(state.testCon, ERC20, wallet);
    console.log('  tCON:', ethers.formatEther(await con.balanceOf(wallet.address)));
  }
  if (state.stakingBank) {
    const bank = new ethers.Contract(state.stakingBank, BANK_VIEW, wallet);
    const con = new ethers.Contract(state.testCon, ERC20, wallet);
    console.log('测试 CON:', state.testCon);
    console.log('质押合约:', state.stakingBank);
    console.log('  合约 tCON 余额:', ethers.formatEther(await con.balanceOf(state.stakingBank)));
    console.log('  stakingToken:', await bank.stakingToken());
    console.log('  rewardToken:', await bank.rewardToken());
    console.log('  feeReceiver:', await bank.feeReceiver());
    console.log('  interactionFee:', ethers.formatEther(await bank.interactionFee()), 'ETH');
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
  else if (step === 'all') {
    await step_deploy(wallet, state);
    await step_config(wallet, state);
    await step_fund(wallet, state);
    await step_pool(wallet, state);
    console.log('\n全部完成！');
    console.log('测试 CON:', state.testCon);
    console.log('质押合约:', state.stakingBank);
    console.log('把这两个地址填进前端 vercel.json 的 VITE_NBT_TOKEN / VITE_STAKING_BANK，并把 VITE_CHAIN_ID 改为 0xaa36a7');
  } else {
    console.log('未知步骤：', step, '（可用 deploy / config / fund / pool / all / status）');
  }
}

main().catch((e) => { console.error('错误:', e.shortMessage || e.message); process.exit(1); });
