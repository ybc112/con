import { useCallback, useEffect, useMemo, useState } from 'react';
import { ethers } from 'ethers';
import toast from 'react-hot-toast';
import {
  FiActivity, FiAlertTriangle, FiCheckCircle, FiClock, FiCopy, FiKey,
  FiPause, FiPlay, FiRefreshCw, FiSend, FiSettings, FiShield, FiSlash,
  FiUploadCloud, FiUserPlus, FiZap,
} from 'react-icons/fi';
import { CONTRACTS, formatAddress, getExplorerAddressUrl, parseContractError } from '../utils/constants';
import { useLanguage } from '../contexts/LanguageContext';
import { useAdminOverview } from '../hooks/useContracts';

// 后台文案（本页新增内容较多，集中在此维护，中英双份）
const LABELS = {
  zh: {
    roleOwner: 'Owner（全部权限）',
    roleOperator: '管理员（运营权限）',
    roleNone: '只读（无管理权限）',
    roleNoneHint: '当前钱包既不是 owner 也不是管理员，所有操作按钮均不可用。',

    overview: '合约总览',
    contractBalance: '合约 CON 余额',
    contractBalanceHint: '包含用户质押本金 + 各奖池，不等同于可用储备',
    totalStaked: '用户质押总量',
    distributable: '可分配储备（估算）',
    distributableHint: '合约余额 − 质押本金，含邀请储备与排名奖池',
    nodeCount: '排行榜节点数',
    epochNow: '当前期号',
    distributedTotal: '累计已分配',

    epochOps: '结算周期运营',
    epochId: '期号',
    poolAmount: '奖池金额',
    snapshotNodes: '快照节点数',
    claimedAmount: '已领取',
    phase: '当前阶段',
    phaseNone: '尚未开期',
    phaseDisplay: '展示期（不可领取）',
    phaseClaim: '领取期（可领取）',
    phaseExpired: '领取期已结束，待结算',
    phaseSettled: '已结算',
    phaseDisabled: '节点不足已合并',
    timeline: '时间轴',
    openTime: '开期时间',
    claimStart: '领取开始',
    claimEnd: '领取结束',
    remaining: '剩余',
    openEpoch: '开期（快照当前榜单）',
    settleEpoch: '结算当前期',
    fundEpoch: '向本期奖池注资',
    amountPlaceholder: '金额（CON）',
    approve: '授权 CON',
    approveInfinite: '授权（无限额度）',
    allowanceNow: '当前授权额度',
    fundEpochBtn: '确认注资',
    epochTipLowNodes: '当前节点数不足 10 个，现在开期会被标记为「合并」，奖池顺延到下一期。',
    epochTipNoEpoch: '尚未开期，本期排名分红为 0。',
    epochTipClaimStarted: '领取期已开始，本期不能再追加注资。',

    invitePool: '邀请储备充值',
    invitePoolDesc: '用户每推荐 1 个达标用户，合约扣 100 CON 作为邀请奖励。储备不足时，被推荐的新用户质押会整笔回滚（NoInviteReserve）。',
    invitePoolBtn: '充值邀请储备',
    invitePoolSupports: '按当前单价，可再支撑',
    invitePoolPeople: '人',
    invitePoolWarning: '可分配储备已低于单次邀请奖励，新用户质押将开始失败，请尽快充值。',

    params: '合约参数设置',
    inviteReward: '邀请奖励单价',
    minReferralStakeValue: '邀请达标门槛',
    stakeValueRate: '固定汇率（1 CON = ? U）',
    priceFeed: '价格源地址',
    priceFeedHint: '设为 0x0 表示回退使用固定汇率；设置后以链上实时价格计分',
    priceFeedUnreadable: '合约未提供 priceFeed() 读取接口，无法显示当前值',
    interactionFee: '交互费配置',
    feeToken: '手续费币种',
    feeTokenNative: 'BNB（原生币）',
    feeAmount: '每笔交互费',
    feeReceiver: '收费地址',
    save: '保存',
    paramLockedHint: '高危参数已锁定，以下设置均不可再修改。',

    operators: '管理员（operator）管理',
    operatorsDesc: '管理员可执行开期、注资、结算、暂停、充值邀请储备；添加/移除仅 owner 可操作。',
    operatorPlaceholder: '输入钱包地址 0x...',
    addOperator: '授权为管理员',
    removeOperator: '移除管理员',

    ownership: '所有权转移',
    ownershipDesc: '两步转移：先发起，再由新地址调用「接受所有权」。转移后你将失去 owner 权限。',
    newOwnerPlaceholder: '新 owner 地址 0x...',
    transferOwnership: '发起转移',
    acceptOwnership: '接受所有权',

    risk: '风控与资金救援',
    recoverToken: '提取误转入的代币',
    recoverTokenDesc: '质押币 / 奖励币 / 手续费币不可提取，其余 ERC20 可救回。',
    tokenAddress: '代币地址',
    toAddress: '接收地址',
    amount: '数量（代币最小单位，整数）',
    recover: '提取',
    sweepNative: '提取合约内误转入的 BNB',
    sweep: '提取 BNB',

    danger: '危险操作',
    pauseTitle: '暂停合约',
    pauseDesc: '暂停后质押、提取、开期全部不可用。请务必先解除暂停再考虑锁定参数。',
    pause: '暂停',
    resume: '恢复运行',
    lockTitle: '锁定全部高危参数（不可逆）',
    lockDesc: '锁死后交互费、价格源、暂停开关、管理员、所有权永久不可修改，仅保留开期/注资/结算运营能力。',
    lock: '立即锁定',
    locked: '已锁定',

    diagnosis: '系统诊断',
    diagOk: '未发现异常',
    diagLockedPaused: '严重：合约处于「暂停 + 参数锁定」状态，暂停将无法解除，用户本金永久锁死。请先恢复运行再锁定参数。',
    diagPaused: '合约当前处于暂停状态，用户无法质押与提取本金。',
    diagReserveLow: '可分配储备偏低，邀请奖励可能随时耗尽。',
    diagNoEpoch: '尚未开期，排名分红为 0，用户质押后看不到任何分红收益。',
    diagLowNodes: '节点数不足 10 个，开期会被合并顺延。',
    diagLocked: '高危参数已锁定（安全模式），owner 仅保留运营能力。',

    refresh: '刷新数据',
    working: '处理中…',
    contractAddress: '合约地址',
    viewOnScan: '在 BscScan 上查看',
    feeNote: '注意：手续费币不可设为质押币或奖励币，费用上限 1 BNB。',
    sweepNote: '交互费为 BNB 时费用即时转给收费地址，正常情况下合约不留存 BNB，此处仅用于救回误转入的资金。',
  },
  en: {
    roleOwner: 'Owner (full access)',
    roleOperator: 'Operator (operations)',
    roleNone: 'Read-only (no admin rights)',
    roleNoneHint: 'This wallet is neither owner nor operator; all actions are disabled.',

    overview: 'Contract Overview',
    contractBalance: 'Contract CON balance',
    contractBalanceHint: 'Includes staked principal and all reward pools',
    totalStaked: 'Total staked',
    distributable: 'Distributable reserve (est.)',
    distributableHint: 'Balance − staked principal (invite reserve + rank pools)',
    nodeCount: 'Ranked nodes',
    epochNow: 'Current epoch',
    distributedTotal: 'Total distributed',

    epochOps: 'Epoch Operations',
    epochId: 'Epoch',
    poolAmount: 'Pool',
    snapshotNodes: 'Snapshot nodes',
    claimedAmount: 'Claimed',
    phase: 'Phase',
    phaseNone: 'Not opened',
    phaseDisplay: 'Display period (no claims)',
    phaseClaim: 'Claim period (open)',
    phaseExpired: 'Claim ended, awaiting settlement',
    phaseSettled: 'Settled',
    phaseDisabled: 'Merged (too few nodes)',
    timeline: 'Timeline',
    openTime: 'Opened',
    claimStart: 'Claim start',
    claimEnd: 'Claim end',
    remaining: 'Remaining',
    openEpoch: 'Open epoch (snapshot ranks)',
    settleEpoch: 'Settle current epoch',
    fundEpoch: 'Fund current epoch pool',
    amountPlaceholder: 'Amount (CON)',
    approve: 'Approve CON',
    approveInfinite: 'Approve (unlimited)',
    allowanceNow: 'Current allowance',
    fundEpochBtn: 'Fund',
    epochTipLowNodes: 'Fewer than 10 nodes: opening now marks the epoch as merged and rolls the pool over.',
    epochTipNoEpoch: 'No epoch opened yet — rank dividends are currently 0.',
    epochTipClaimStarted: 'Claim period has started; no further funding this epoch.',

    invitePool: 'Invite Reserve Top-up',
    invitePoolDesc: 'Each qualified referral deducts 100 CON. If the reserve runs out, new referred users cannot stake (NoInviteReserve).',
    invitePoolBtn: 'Top up reserve',
    invitePoolSupports: 'Supports about',
    invitePoolPeople: 'users',
    invitePoolWarning: 'Distributable reserve is below one invite reward — new stakes will start failing.',

    params: 'Contract Parameters',
    inviteReward: 'Invite reward',
    minReferralStakeValue: 'Qualification threshold',
    stakeValueRate: 'Fixed rate (1 CON = ? U)',
    priceFeed: 'Price feed',
    priceFeedHint: '0x0 falls back to the fixed rate; otherwise scoring uses the on-chain price',
    priceFeedUnreadable: 'Contract exposes no priceFeed() getter — current value cannot be read',
    interactionFee: 'Interaction fee',
    feeToken: 'Fee token',
    feeTokenNative: 'BNB (native)',
    feeAmount: 'Fee per call',
    feeReceiver: 'Receiver',
    save: 'Save',
    paramLockedHint: 'High-risk parameters are locked; these settings can no longer be changed.',

    operators: 'Operators',
    operatorsDesc: 'Operators can open/fund/settle epochs, pause, and top up the invite reserve. Only the owner can add or remove them.',
    operatorPlaceholder: 'Wallet address 0x...',
    addOperator: 'Grant operator',
    removeOperator: 'Revoke operator',

    ownership: 'Ownership Transfer',
    ownershipDesc: 'Two-step: initiate here, then the new address must accept. You lose owner rights afterwards.',
    newOwnerPlaceholder: 'New owner address 0x...',
    transferOwnership: 'Initiate transfer',
    acceptOwnership: 'Accept ownership',

    risk: 'Risk Controls & Rescue',
    recoverToken: 'Recover wrong tokens',
    recoverTokenDesc: 'Staking / reward / fee tokens cannot be recovered; other ERC20s can.',
    tokenAddress: 'Token address',
    toAddress: 'Recipient',
    amount: 'Amount (in base units)',
    recover: 'Recover',
    sweepNative: 'Sweep stray BNB',
    sweep: 'Sweep BNB',

    danger: 'Danger Zone',
    pauseTitle: 'Pause contract',
    pauseDesc: 'Pausing blocks staking, withdrawal and epoch opening. Always unpause before locking parameters.',
    pause: 'Pause',
    resume: 'Resume',
    lockTitle: 'Lock all high-risk params (irreversible)',
    lockDesc: 'Freezes fee config, price feed, pause switch, operators and ownership forever; only epoch operations remain.',
    lock: 'Lock now',
    locked: 'Locked',

    diagnosis: 'System Diagnosis',
    diagOk: 'No issues detected',
    diagLockedPaused: 'CRITICAL: contract is paused AND params are locked — pause can never be lifted and user principal is frozen. Resume before locking.',
    diagPaused: 'Contract is paused: users cannot stake or withdraw principal.',
    diagReserveLow: 'Distributable reserve is low; invite rewards may run out soon.',
    diagNoEpoch: 'No epoch opened yet — rank dividends are 0.',
    diagLowNodes: 'Fewer than 10 nodes; opening an epoch will merge it into the next one.',
    diagLocked: 'High-risk params locked (safe mode); owner keeps operational rights only.',

    refresh: 'Refresh',
    working: 'Working…',
    contractAddress: 'Contract Address',
    viewOnScan: 'View on BscScan',
    feeNote: 'The fee token cannot be the staking or reward token; max fee is 1 BNB.',
    sweepNote: 'When the fee is paid in BNB it is forwarded immediately, so the contract normally holds none. This only rescues stray transfers.',
  },
};

const fmtAmt = (value, decimals = 4) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  const fixed = n.toFixed(decimals);
  return fixed.replace(/\.?0+$/, '') || '0';
};

const fmtCsv = (value, decimals = 4) =>
  Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: decimals });

const fmtTime = (seconds) => {
  if (!seconds) return '—';
  return new Date(seconds * 1000).toLocaleString('zh-CN', { hour12: false });
};

const fmtDuration = (seconds) => {
  if (seconds === null || seconds === undefined) return '—';
  if (seconds <= 0) return '0s';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${Math.floor(seconds % 60)}s`;
};

function Card({ icon: Icon, title, tone = '#38BDF8', children, className = '' }) {
  return (
    <section className={`glass-premium p-5 ${className}`}>
      <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
        {Icon && <Icon style={{ color: tone }} />}
        {title}
      </h2>
      {children}
    </section>
  );
}

function Stat({ label, value, suffix, hint, tone = 'text-white' }) {
  return (
    <div className="stat-card-premium">
      <div className="text-white/45 text-sm mb-2">{label}</div>
      <div className={`text-2xl font-bold ${tone}`}>
        {value} {suffix && <span className="text-sm text-white/40">{suffix}</span>}
      </div>
      {hint && <div className="text-xs text-white/35 mt-2 leading-relaxed">{hint}</div>}
    </div>
  );
}

export default function AdminPage({ account, contracts, stakingData, onRefresh }) {
  const { t, language } = useLanguage();
  const l = useCallback((key) => LABELS[language]?.[key] ?? LABELS.zh[key] ?? key, [language]);

  const [working, setWorking] = useState('');
  const [releaseAmount, setReleaseAmount] = useState('');
  const [invitePoolAmount, setInvitePoolAmount] = useState('');
  const [inviteReward, setInviteReward] = useState('');
  const [minStakeValue, setMinStakeValue] = useState('');
  const [stakeValueRate, setStakeValueRate] = useState('');
  const [priceFeed, setPriceFeed] = useState('');
  const [feeToken, setFeeToken] = useState('');
  const [feeAmount, setFeeAmount] = useState('');
  const [feeReceiver, setFeeReceiver] = useState('');
  const [operatorAddr, setOperatorAddr] = useState('');
  const [newOwner, setNewOwner] = useState('');
  const [recoverToken, setRecoverToken] = useState('');
  const [recoverTo, setRecoverTo] = useState('');
  const [recoverAmount, setRecoverAmount] = useState('');
  const [sweepTo, setSweepTo] = useState('');
  const [allowance, setAllowance] = useState(null);
  const [nowSec, setNowSec] = useState(Math.floor(Date.now() / 1000));

  const overview = useAdminOverview(contracts, account);

  const mining = stakingData?.miningStatus;
  const epoch = stakingData?.currentRelease;
  const feeConfig = stakingData?.interactionFeeConfig;

  const canWrite = !!account && !!contracts?.writeStakingBank;
  const isOwner = overview.isOwner;
  const isOperator = overview.isOperator;
  const canOperate = isOwner || isOperator;         // 对应合约 onlyAdmin
  const locked = overview.paramsLocked;
  const paused = !!stakingData?.isPaused;

  const contractBalance = overview.contractBalance ?? '0';
  const totalStaked = mining?.totalStaked ?? '0';
  const distributable = useMemo(() => {
    const n = Number(contractBalance) - Number(totalStaked);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [contractBalance, totalStaked]);

  const inviteRewardValue = Number(stakingData?.inviteReward ?? '100') || 0;
  const supportedUsers = inviteRewardValue > 0 ? Math.floor(distributable / inviteRewardValue) : 0;

  // 领取授权额度：注资/充值都需要把 CON 授权给质押合约
  const refetchAllowance = useCallback(async () => {
    if (!contracts?.nbtToken || !account || !CONTRACTS.STAKING_BANK) return;
    try {
      const value = await contracts.nbtToken.allowance(account, CONTRACTS.STAKING_BANK);
      setAllowance(ethers.formatEther(value));
    } catch {
      setAllowance(null);
    }
  }, [contracts?.nbtToken, account]);

  useEffect(() => { refetchAllowance(); }, [refetchAllowance]);

  // 用于倒计时的秒级心跳
  useEffect(() => {
    const timer = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);

  // 阶段判定（展示期 3 天 + 领取期 7 天）
  const phase = useMemo(() => {
    if (!epoch || Number(epoch.epochId) === 0) return 'none';
    if (epoch.disabled) return 'disabled';
    if (epoch.settled) return 'settled';
    if (!epoch.claimStart) return 'display';
    if (nowSec < epoch.claimStart) return 'display';
    if (nowSec < epoch.claimEnd) return 'claim';
    return 'expired';
  }, [epoch, nowSec]);

  const canOpenEpoch = canOperate && !paused && ['none', 'disabled', 'settled', 'expired'].includes(phase);
  const canSettleEpoch = canOperate && !paused && ['expired', 'disabled'].includes(phase);
  // 合约规则：本期未结算，且「不在领取窗口内」（合并期不受限）时才允许注资
  const canFundEpoch = canOperate && !paused && ['display', 'disabled', 'expired'].includes(phase);

  const refresh = useCallback(() => {
    onRefresh?.();
    overview.refetch();
    refetchAllowance();
  }, [onRefresh, overview, refetchAllowance]);

  // 统一写操作封装：loading 提示 + 错误解码 + 成功后刷新
  const run = useCallback(async (key, loadingText, successText, fn) => {
    if (!canWrite) return;
    setWorking(key);
    toast.loading(loadingText, { id: key });
    try {
      const tx = await fn();
      await tx.wait();
      toast.success(successText, { id: key });
      refresh();
      return true;
    } catch (err) {
      toast.error(parseContractError(err), { id: key });
      return false;
    } finally {
      setWorking('');
    }
  }, [canWrite, refresh]);

  const parseAmount = (value, allowZero = false) => {
    try {
      if (value === '' || value === null || value === undefined) throw new Error('empty');
      const parsed = ethers.parseEther(String(value));
      if (!allowZero && parsed <= 0n) throw new Error('zero');
      return parsed;
    } catch {
      toast.error(allowZero ? '请输入有效的非负金额' : '请输入有效的正数金额');
      return null;
    }
  };

  // recoverWrongToken 的 amount 是最小单位原始值，不做 1e18 换算
  const parseRawUnits = (value) => {
    try {
      const parsed = BigInt(String(value).trim());
      if (parsed <= 0n) throw new Error('zero');
      return parsed;
    } catch {
      toast.error('请输入整数金额（代币最小单位，如 1 个 18 位代币 = 1000000000000000000）');
      return null;
    }
  };

  const requireAddress = (value) => {
    if (!ethers.isAddress(value)) {
      toast.error('请输入有效的钱包地址');
      return null;
    }
    return value;
  };

  const isBusy = (key) => working === key;
  const anyBusy = working !== '';

  const copyAddress = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('cz.common.copied'));
    } catch {
      toast.error(text);
    }
  };

  // ---- 授权（用无限额度，避免覆盖质押页已设置的 MaxUint256 授权）----
  const approveToken = () => run(
    'approve', '正在授权…', '授权成功',
    () => contracts.writeNbtToken.approve(CONTRACTS.STAKING_BANK, ethers.MaxUint256)
  );

  // ---- 周期操作 ----
  const openEpoch = () => run('openEpoch', '正在开期…', '开期成功', () => contracts.writeStakingBank.openEpoch());
  const settleEpoch = () => run('settleEpoch', '正在结算…', '结算成功', () => contracts.writeStakingBank.settleEpoch());
  const fundEpoch = () => {
    const amount = parseAmount(releaseAmount);
    if (!amount) return;
    run('fundEpoch', '正在注资…', '注资成功', async () => {
      const tx = await contracts.writeStakingBank.fundEpoch(amount);
      setReleaseAmount('');
      return tx;
    });
  };

  // ---- 邀请储备 ----
  const fundInvitePool = () => {
    const amount = parseAmount(invitePoolAmount);
    if (!amount) return;
    run('fundInvitePool', '正在充值邀请储备…', '邀请储备充值成功', async () => {
      const tx = await contracts.writeStakingBank.fundInvitePool(amount);
      setInvitePoolAmount('');
      return tx;
    });
  };

  // ---- 参数 ----
  const saveInviteReward = () => {
    const amount = parseAmount(inviteReward);
    if (!amount) return;
    run('inviteReward', '正在保存…', '邀请奖励单价已更新', async () => {
      const tx = await contracts.writeStakingBank.setInviteReward(amount);
      setInviteReward('');
      return tx;
    });
  };

  const saveMinStakeValue = () => {
    const amount = parseAmount(minStakeValue, true);
    if (amount === null) return;
    run('minStake', '正在保存…', '邀请达标门槛已更新', async () => {
      const tx = await contracts.writeStakingBank.setMinReferralStakeValue(amount);
      setMinStakeValue('');
      return tx;
    });
  };

  const saveStakeValueRate = () => {
    const amount = parseAmount(stakeValueRate);
    if (!amount) return;
    run('stakeRate', '正在保存…', '汇率已更新', async () => {
      const tx = await contracts.writeStakingBank.setStakeValueRate(amount);
      setStakeValueRate('');
      return tx;
    });
  };

  const savePriceFeed = () => {
    const addr = requireAddress(priceFeed);
    if (!addr) return;
    run('priceFeed', '正在保存…', '价格源已更新', async () => {
      const tx = await contracts.writeStakingBank.setPriceFeed(addr);
      setPriceFeed('');
      return tx;
    });
  };

  const saveFeeConfig = () => {
    const receiver = requireAddress(feeReceiver);
    if (!receiver) return;
    let token = ethers.ZeroAddress;
    if (feeToken && feeToken !== ethers.ZeroAddress) {
      const parsed = requireAddress(feeToken);
      if (!parsed) return;
      token = parsed;
    }
    // fee 允许为 0（表示关闭交互费）
    let fee = 0n;
    try {
      fee = feeAmount === '' ? 0n : ethers.parseEther(String(feeAmount));
    } catch {
      toast.error('请输入有效的交互费金额');
      return;
    }
    run('feeConfig', '正在保存…', '交互费配置已更新', async () => {
      const tx = await contracts.writeStakingBank.setInteractionFeeConfig(token, fee, receiver);
      setFeeToken(''); setFeeAmount(''); setFeeReceiver('');
      return tx;
    });
  };

  // ---- 管理员 ----
  const setOperator = (status) => {
    const addr = requireAddress(operatorAddr);
    if (!addr) return;
    if (addr.toLowerCase() === account?.toLowerCase()) {
      toast.error('不能把自己设为管理员');
      return;
    }
    run('operator', status ? '正在授权…' : '正在移除…', status ? '管理员已添加' : '管理员已移除', async () => {
      const tx = await contracts.writeStakingBank.setOperator(addr, status);
      setOperatorAddr('');
      return tx;
    });
  };

  // ---- 所有权 ----
  const transferOwnership = () => {
    const addr = requireAddress(newOwner);
    if (!addr) return;
    if (!window.confirm(`确认将合约所有权转移给 ${addr}？转移后你将失去 owner 权限。`)) return;
    run('transferOwner', '正在发起转移…', '已发起转移，等待新地址接受', async () => {
      const tx = await contracts.writeStakingBank.transferOwnership(addr);
      setNewOwner('');
      return tx;
    });
  };

  const acceptOwnership = () => run('acceptOwner', '正在接受所有权…', '所有权已接受', () => contracts.writeStakingBank.acceptOwnership());

  // ---- 风控 ----
  const handleRecoverToken = () => {
    const token = requireAddress(recoverToken);
    const to = requireAddress(recoverTo);
    if (!token || !to) return;
    const rawAmount = parseRawUnits(recoverAmount);
    if (rawAmount === null) return;
    run('recover', '正在提取…', '已提取', async () => {
      const tx = await contracts.writeStakingBank.recoverWrongToken(token, to, rawAmount);
      setRecoverToken(''); setRecoverTo(''); setRecoverAmount('');
      return tx;
    });
  };

  const sweepNative = () => {
    const to = requireAddress(sweepTo);
    if (!to) return;
    run('sweep', '正在提取 BNB…', 'BNB 已提取', async () => {
      const tx = await contracts.writeStakingBank.sweepNative(to);
      setSweepTo('');
      return tx;
    });
  };

  // ---- 暂停 / 锁定 ----
  const setPaused = (next) => run('pause', next ? '正在暂停…' : '正在恢复…', next ? '已暂停' : '已恢复', () =>
    next ? contracts.writeStakingBank.pause() : contracts.writeStakingBank.unpause());

  const lockParams = () => {
    if (paused) {
      toast.error('合约处于暂停状态，禁止锁定参数（否则暂停将永久无法解除）');
      return;
    }
    if (!window.confirm('锁定后交互费、价格源、暂停开关、管理员、所有权将永久不可修改（不可逆）。确认锁定？')) return;
    run('lock', '正在锁定…', '参数已锁定', () => contracts.writeStakingBank.lockAdminParams());
  };

  // ---- 诊断 ----
  const diagnostics = useMemo(() => {
    const list = [];
    if (locked && paused) list.push({ level: 'error', text: l('diagLockedPaused') });
    else if (paused) list.push({ level: 'warn', text: l('diagPaused') });
    if (distributable < inviteRewardValue) list.push({ level: 'warn', text: l('diagReserveLow') });
    if (phase === 'none') list.push({ level: 'warn', text: l('diagNoEpoch') });
    else if (Number(mining?.rankedNodeCount || 0) < 10) list.push({ level: 'info', text: l('diagLowNodes') });
    if (locked) list.push({ level: 'info', text: l('diagLocked') });
    return list;
  }, [locked, paused, distributable, inviteRewardValue, phase, mining?.rankedNodeCount, l]);

  const claimRemaining = phase === 'claim' ? epoch.claimEnd - nowSec : null;
  const displayRemaining = phase === 'display' && epoch?.claimStart ? epoch.claimStart - nowSec : null;

  return (
    <div className="space-y-8">
      {/* 头部 */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-white flex items-center gap-3">
            <FiShield className="text-[#FFB800]" />
            {t('cz.admin.title')}
          </h1>
          <p className="text-white/50 mt-1">{t('cz.admin.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className={`badge-glow ${isOwner ? 'text-[#FFB800]' : isOperator ? 'text-[#38BDF8]' : 'text-white/50'}`}>
            {isOwner ? l('roleOwner') : isOperator ? l('roleOperator') : l('roleNone')}
          </span>
          <button onClick={refresh} className="btn-ghost flex items-center gap-2 text-sm">
            <FiRefreshCw /> {l('refresh')}
          </button>
        </div>
      </div>

      {!canOperate && account && (
        <div className="rounded-xl bg-[#FFB800]/10 border border-[#FFB800]/30 p-4 text-sm text-white/70">
          {l('roleNoneHint')}
        </div>
      )}

      {/* 诊断 */}
      <Card icon={FiActivity} title={l('diagnosis')} tone="#FFB800">
        {diagnostics.length === 0 ? (
          <div className="flex items-center gap-2 text-[#38BDF8] text-sm">
            <FiCheckCircle /> {l('diagOk')}
          </div>
        ) : (
          <ul className="space-y-2">
            {diagnostics.map((item, index) => (
              <li
                key={index}
                className={`flex items-start gap-2 text-sm rounded-lg p-3 border ${
                  item.level === 'error'
                    ? 'bg-red-500/10 border-red-500/30 text-red-200'
                    : item.level === 'warn'
                      ? 'bg-[#FFB800]/10 border-[#FFB800]/30 text-[#FFD98A]'
                      : 'bg-white/5 border-white/10 text-white/60'
                }`}
              >
                <FiAlertTriangle className="mt-0.5 shrink-0" />
                <span>{item.text}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* 总览 */}
      <div>
        <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <FiZap className="text-[#38BDF8]" />
          {l('overview')}
        </h2>
        <section className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Stat
          label={l('contractBalance')}
          value={fmtCsv(contractBalance)}
          suffix="CON"
          hint={l('contractBalanceHint')}
        />
        <Stat label={l('totalStaked')} value={fmtCsv(totalStaked)} suffix="CON" />
        <Stat
          label={l('distributable')}
          value={fmtCsv(distributable)}
          suffix="CON"
          hint={l('distributableHint')}
          tone={distributable < inviteRewardValue ? 'text-[#FFB800]' : 'text-white'}
        />
        <Stat label={l('nodeCount')} value={fmtCsv(mining?.rankedNodeCount ?? 0, 0)} suffix="个" />
        <Stat
          label={l('epochNow')}
          value={`#${epoch?.epochId ?? 0}`}
          suffix={epoch?.amount ? `${fmtCsv(epoch.amount)} CON` : ''}
        />
        <Stat label={l('distributedTotal')} value={fmtCsv(mining?.totalDistributed)} suffix="CON" />
        </section>
      </div>

      {/* 邀请储备充值 */}
      <Card icon={FiUploadCloud} title={l('invitePool')} tone="#FFB800" className="border-l-4 border-l-[#FFB800]/70">
        <p className="text-sm text-white/55 mb-4 leading-relaxed">{l('invitePoolDesc')}</p>

        <div className="mb-4 p-4 rounded-xl bg-white/5 border border-white/10 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs text-white/40 mb-1">{l('invitePoolSupports')}</div>
            <div className="text-xl font-bold text-white">
              {fmtCsv(supportedUsers, 0)} <span className="text-sm text-white/40">{l('invitePoolPeople')}</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-white/40 mb-1">{l('allowanceNow')}</div>
            <div className="text-sm font-mono text-white/70">
              {allowance === null ? '—' : Number(allowance) > 1e30 ? '∞' : `${fmtCsv(allowance)} CON`}
            </div>
          </div>
        </div>

        {distributable < inviteRewardValue && (
          <div className="mb-4 rounded-lg bg-[#FFB800]/10 border border-[#FFB800]/30 p-3 text-sm text-[#FFD98A] flex items-start gap-2">
            <FiAlertTriangle className="mt-0.5 shrink-0" />
            <span>{l('invitePoolWarning')}</span>
          </div>
        )}

        <div className="grid sm:grid-cols-[1fr_auto_auto] gap-3">
          <input
            className="input-premium"
            value={invitePoolAmount}
            onChange={(e) => setInvitePoolAmount(e.target.value)}
            placeholder={l('amountPlaceholder')}
          />
          <button onClick={approveToken} disabled={anyBusy || !canWrite} className="btn-ghost disabled:opacity-50">
            {l('approveInfinite')}
          </button>
          <button
            onClick={fundInvitePool}
            disabled={anyBusy || !canOperate || !invitePoolAmount || paused}
            className="btn-premium disabled:opacity-50"
          >
            <span>{isBusy('fundInvitePool') ? l('working') : l('invitePoolBtn')}</span>
          </button>
        </div>
      </Card>

      {/* 周期运营 */}
      <Card icon={FiClock} title={l('epochOps')} tone="#38BDF8">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          <div className="p-3 rounded-xl bg-white/5 border border-white/10">
            <div className="text-xs text-white/40 mb-1">{l('phase')}</div>
            <div className="text-sm font-bold text-white">
              {l(`phase${phase.charAt(0).toUpperCase()}${phase.slice(1)}`)}
            </div>
          </div>
          <div className="p-3 rounded-xl bg-white/5 border border-white/10">
            <div className="text-xs text-white/40 mb-1">{l('poolAmount')}</div>
            <div className="text-sm font-bold text-white">{fmtCsv(epoch?.amount)} CON</div>
          </div>
          <div className="p-3 rounded-xl bg-white/5 border border-white/10">
            <div className="text-xs text-white/40 mb-1">{l('snapshotNodes')}</div>
            <div className="text-sm font-bold text-white">{fmtCsv(epoch?.totalNodes ?? 0, 0)}</div>
          </div>
          <div className="p-3 rounded-xl bg-white/5 border border-white/10">
            <div className="text-xs text-white/40 mb-1">{l('claimedAmount')}</div>
            <div className="text-sm font-bold text-white">{fmtCsv(epoch?.totalClaimed)} CON</div>
          </div>
        </div>

        {epoch && Number(epoch.epochId) > 0 && (
          <div className="mb-5 p-4 rounded-xl bg-white/5 border border-white/10">
            <div className="text-xs text-white/40 mb-3">{l('timeline')}</div>
            <div className="grid sm:grid-cols-3 gap-3 text-sm">
              <div>
                <div className="text-white/35 text-xs mb-1">{l('claimStart')}</div>
                <div className="text-white/80">{fmtTime(epoch.claimStart)}</div>
              </div>
              <div>
                <div className="text-white/35 text-xs mb-1">{l('claimEnd')}</div>
                <div className="text-white/80">{fmtTime(epoch.claimEnd)}</div>
              </div>
              <div>
                <div className="text-white/35 text-xs mb-1">{l('remaining')}</div>
                <div className="text-white/80">
                  {claimRemaining !== null ? fmtDuration(claimRemaining)
                    : displayRemaining !== null ? fmtDuration(displayRemaining)
                    : '—'}
                </div>
              </div>
            </div>
          </div>
        )}

        {phase === 'none' && (
          <div className="mb-4 rounded-lg bg-[#FFB800]/10 border border-[#FFB800]/30 p-3 text-sm text-[#FFD98A]">
            {l('epochTipNoEpoch')}
          </div>
        )}
        {phase !== 'none' && phase !== 'disabled' && Number(mining?.rankedNodeCount || 0) < 10 && (
          <div className="mb-4 rounded-lg bg-[#FFB800]/10 border border-[#FFB800]/30 p-3 text-sm text-[#FFD98A]">
            {l('epochTipLowNodes')}
          </div>
        )}
        {phase === 'claim' && (
          <div className="mb-4 rounded-lg bg-[#38BDF8]/10 border border-[#38BDF8]/30 p-3 text-sm text-[#9BD9F5]">
            {l('epochTipClaimStarted')}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 mb-4">
          <button onClick={openEpoch} disabled={anyBusy || !canOpenEpoch} className="btn-ghost disabled:opacity-50">
            {isBusy('openEpoch') ? l('working') : l('openEpoch')}
          </button>
          <button onClick={settleEpoch} disabled={anyBusy || !canSettleEpoch} className="btn-ghost disabled:opacity-50">
            {isBusy('settleEpoch') ? l('working') : l('settleEpoch')}
          </button>
        </div>

        <div className="grid sm:grid-cols-[1fr_auto] gap-3">
          <input
            className="input-premium"
            value={releaseAmount}
            onChange={(e) => setReleaseAmount(e.target.value)}
            placeholder={l('amountPlaceholder')}
          />
          <button
            onClick={fundEpoch}
            disabled={anyBusy || !canFundEpoch || !releaseAmount}
            className="btn-premium disabled:opacity-50"
          >
            <span>{isBusy('fundEpoch') ? l('working') : l('fundEpochBtn')}</span>
          </button>
        </div>
      </Card>

      {/* 参数设置 */}
      <Card icon={FiSettings} title={l('params')} tone="#38BDF8">
        {locked && (
          <div className="mb-4 rounded-lg bg-white/5 border border-white/10 p-3 text-sm text-white/50">
            {l('paramLockedHint')}
          </div>
        )}

        <div className="grid lg:grid-cols-2 gap-5">
          <div className="space-y-3">
            <div className="text-xs text-white/40">
              {l('inviteReward')} · 当前 {fmtAmt(stakingData?.inviteReward ?? '100')} CON
            </div>
            <div className="grid grid-cols-[1fr_auto] gap-3">
              <input className="input-premium" value={inviteReward} onChange={(e) => setInviteReward(e.target.value)} placeholder="100" />
              <button onClick={saveInviteReward} disabled={anyBusy || !isOwner || locked} className="btn-ghost disabled:opacity-50">{l('save')}</button>
            </div>

            <div className="text-xs text-white/40 pt-2">
              {l('minReferralStakeValue')} · 当前 {fmtAmt(stakingData?.minReferralStakeValue ?? '100')} U
            </div>
            <div className="grid grid-cols-[1fr_auto] gap-3">
              <input className="input-premium" value={minStakeValue} onChange={(e) => setMinStakeValue(e.target.value)} placeholder="100" />
              <button onClick={saveMinStakeValue} disabled={anyBusy || !isOwner || locked} className="btn-ghost disabled:opacity-50">{l('save')}</button>
            </div>

            <div className="text-xs text-white/40 pt-2">
              {l('stakeValueRate')} · 当前 {fmtAmt(stakingData?.stakeValueRate ?? '1')}
            </div>
            <div className="grid grid-cols-[1fr_auto] gap-3">
              <input className="input-premium" value={stakeValueRate} onChange={(e) => setStakeValueRate(e.target.value)} placeholder="1" />
              <button onClick={saveStakeValueRate} disabled={anyBusy || !isOwner || locked} className="btn-ghost disabled:opacity-50">{l('save')}</button>
            </div>

            <div className="text-xs text-white/40 pt-2">{l('priceFeed')}</div>
            <div className="text-xs text-white/30 mb-1">{l('priceFeedHint')}</div>
            <div className="text-xs text-white/30 mb-2">{l('priceFeedUnreadable')}</div>
            <div className="grid grid-cols-[1fr_auto] gap-3">
              <input className="input-premium font-mono text-sm" value={priceFeed} onChange={(e) => setPriceFeed(e.target.value)} placeholder={ethers.ZeroAddress} />
              <button onClick={savePriceFeed} disabled={anyBusy || !isOwner || locked} className="btn-ghost disabled:opacity-50">{l('save')}</button>
            </div>
          </div>

          <div className="space-y-3 lg:border-l lg:border-white/10 lg:pl-5">
            <div className="text-sm font-bold text-white/80">{l('interactionFee')}</div>
            <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-xs text-white/55 space-y-1">
              <div>{l('feeToken')}: <span className="font-mono text-white/75">{feeConfig?.feeToken === ethers.ZeroAddress || !feeConfig?.feeToken ? l('feeTokenNative') : formatAddress(feeConfig.feeToken)}</span></div>
              <div>{l('feeAmount')}: <span className="font-mono text-white/75">{fmtAmt(feeConfig?.fee ?? '0', 8)} {feeConfig?.feeToken === ethers.ZeroAddress || !feeConfig?.feeToken ? 'BNB' : ''}</span></div>
              <div>{l('feeReceiver')}: <span className="font-mono text-white/75">{feeConfig?.receiverA ? formatAddress(feeConfig.receiverA) : '—'}</span></div>
            </div>

            <input className="input-premium font-mono text-sm" value={feeToken} onChange={(e) => setFeeToken(e.target.value)} placeholder={`${l('feeToken')} — 留空 = BNB`} />
            <input className="input-premium" value={feeAmount} onChange={(e) => setFeeAmount(e.target.value)} placeholder={`${l('feeAmount')} (BNB)`} />
            <input className="input-premium font-mono text-sm" value={feeReceiver} onChange={(e) => setFeeReceiver(e.target.value)} placeholder={`${l('feeReceiver')} 0x...`} />
            <button onClick={saveFeeConfig} disabled={anyBusy || !isOwner || locked || !feeReceiver} className="w-full btn-premium disabled:opacity-50">
              <span>{l('save')}</span>
            </button>
            <p className="text-xs text-white/30 leading-relaxed">{l('feeNote')}</p>
          </div>
        </div>
      </Card>

      {/* 管理员 + 所有权 */}
      <section className="grid lg:grid-cols-2 gap-6">
        <Card icon={FiUserPlus} title={l('operators')} tone="#38BDF8">
          <p className="text-xs text-white/45 mb-4 leading-relaxed">{l('operatorsDesc')}</p>
          <input
            className="input-premium font-mono text-sm mb-3"
            value={operatorAddr}
            onChange={(e) => setOperatorAddr(e.target.value)}
            placeholder={l('operatorPlaceholder')}
          />
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => setOperator(true)} disabled={anyBusy || !isOwner || locked || !operatorAddr} className="btn-premium disabled:opacity-50">
              <span>{l('addOperator')}</span>
            </button>
            <button onClick={() => setOperator(false)} disabled={anyBusy || !isOwner || locked || !operatorAddr} className="btn-ghost disabled:opacity-50">
              {l('removeOperator')}
            </button>
          </div>
        </Card>

        <Card icon={FiKey} title={l('ownership')} tone="#FFB800">
          <p className="text-xs text-white/45 mb-4 leading-relaxed">{l('ownershipDesc')}</p>
          <div className="mb-3 p-3 rounded-xl bg-white/5 border border-white/10 text-xs">
            <div className="text-white/40 mb-1">owner</div>
            <button
              onClick={() => overview.owner && copyAddress(overview.owner)}
              className="font-mono text-white/75 hover:text-[#38BDF8] break-all text-left"
            >
              {overview.owner || '—'} <FiCopy className="inline ml-1" />
            </button>
          </div>
          <input
            className="input-premium font-mono text-sm mb-3"
            value={newOwner}
            onChange={(e) => setNewOwner(e.target.value)}
            placeholder={l('newOwnerPlaceholder')}
          />
          <div className="grid grid-cols-2 gap-3">
            <button onClick={transferOwnership} disabled={anyBusy || !isOwner || locked || !newOwner} className="btn-ghost disabled:opacity-50">
              {l('transferOwnership')}
            </button>
            <button onClick={acceptOwnership} disabled={anyBusy || locked} className="btn-ghost disabled:opacity-50">
              {l('acceptOwnership')}
            </button>
          </div>
        </Card>
      </section>

      {/* 风控 */}
      <Card icon={FiZap} title={l('risk')} tone="#38BDF8">
        <div className="grid lg:grid-cols-2 gap-6">
          <div className="space-y-3">
            <div className="text-sm font-bold text-white/80">{l('recoverToken')}</div>
            <p className="text-xs text-white/45 leading-relaxed">{l('recoverTokenDesc')}</p>
            <input className="input-premium font-mono text-sm" value={recoverToken} onChange={(e) => setRecoverToken(e.target.value)} placeholder={`${l('tokenAddress')} 0x...`} />
            <input className="input-premium font-mono text-sm" value={recoverTo} onChange={(e) => setRecoverTo(e.target.value)} placeholder={`${l('toAddress')} 0x...`} />
            <input className="input-premium" value={recoverAmount} onChange={(e) => setRecoverAmount(e.target.value)} placeholder={l('amount')} />
            <button onClick={handleRecoverToken} disabled={anyBusy || !isOwner || !recoverToken || !recoverTo || !recoverAmount} className="w-full btn-ghost disabled:opacity-50">
              {l('recover')}
            </button>
          </div>

          <div className="space-y-3 lg:border-l lg:border-white/10 lg:pl-6">
            <div className="text-sm font-bold text-white/80">{l('sweepNative')}</div>
            <p className="text-xs text-white/45 leading-relaxed">{l('sweepNote')}</p>
            <input className="input-premium font-mono text-sm" value={sweepTo} onChange={(e) => setSweepTo(e.target.value)} placeholder={`${l('toAddress')} 0x...`} />
            <button onClick={sweepNative} disabled={anyBusy || !isOwner || !sweepTo} className="w-full btn-ghost disabled:opacity-50">
              {l('sweep')}
            </button>
          </div>
        </div>
      </Card>

      {/* 危险区 */}
      <Card icon={FiSlash} title={l('danger')} tone="#FF6B6B" className="border-l-4 border-l-red-500/60">
        <div className="grid lg:grid-cols-2 gap-6">
          <div>
            <h3 className="text-base font-bold text-white mb-2 flex items-center gap-2">
              <FiPause className="text-[#FFB800]" /> {l('pauseTitle')}
            </h3>
            <p className="text-sm text-white/45 mb-4 leading-relaxed">{l('pauseDesc')}</p>
            <div className="flex gap-3">
              <button
                onClick={() => setPaused(true)}
                disabled={anyBusy || !canOperate || paused || locked}
                className="px-4 py-2 rounded-lg bg-[#FFB800]/20 text-[#FFB800] disabled:opacity-40 flex items-center gap-2"
              >
                <FiPause /> {l('pause')}
              </button>
              <button
                onClick={() => setPaused(false)}
                disabled={anyBusy || !canOperate || !paused || locked}
                className="px-4 py-2 rounded-lg bg-[#38BDF8]/20 text-[#38BDF8] disabled:opacity-40 flex items-center gap-2"
              >
                <FiPlay /> {l('resume')}
              </button>
            </div>
          </div>

          <div className="lg:border-l lg:border-white/10 lg:pl-6">
            <h3 className="text-base font-bold text-white mb-2 flex items-center gap-2">
              <FiShield className="text-[#FFB800]" /> {l('lockTitle')}
            </h3>
            <p className="text-sm text-white/45 mb-4 leading-relaxed">{l('lockDesc')}</p>
            {paused && !locked && (
              <div className="mb-3 rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-200 flex items-start gap-2">
                <FiAlertTriangle className="mt-0.5 shrink-0" />
                <span>{l('diagLockedPaused')}</span>
              </div>
            )}
            <button
              onClick={lockParams}
              disabled={anyBusy || !isOwner || locked}
              className="px-4 py-2 rounded-lg bg-[#FFB800]/20 text-[#FFB800] disabled:opacity-40 flex items-center gap-2"
            >
              <FiShield /> {locked ? l('locked') : l('lock')}
            </button>
          </div>
        </div>
      </Card>

      {/* 合约地址 */}
      <Card icon={FiSend} title={l('contractAddress')} tone="#38BDF8">
        <button
          onClick={() => copyAddress(CONTRACTS.STAKING_BANK)}
          className="w-full flex items-center justify-between gap-3 rounded-lg bg-[#0B1120]/60 px-3 py-3 text-left font-mono text-sm text-white/80 hover:bg-white/10"
        >
          <span className="truncate">{CONTRACTS.STAKING_BANK}</span>
          <FiCopy className="shrink-0 text-[#FFB800]" />
        </button>
        <a
          href={getExplorerAddressUrl(CONTRACTS.STAKING_BANK)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 mt-3 text-xs text-[#38BDF8] hover:underline"
        >
          <FiSend /> {l('viewOnScan')}
        </a>
      </Card>
    </div>
  );
}
