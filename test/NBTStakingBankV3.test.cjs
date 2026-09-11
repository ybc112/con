const { expect } = require('chai');
const { ethers } = require('hardhat');
const { loadFixture, time } = require('@nomicfoundation/hardhat-network-helpers');

const FEE = ethers.parseEther('0.00065118');
const DAYS = (n) => n * 24 * 60 * 60;
const ZERO = ethers.ZeroAddress;

// 部署 tCON + 质押合约，并给合约 100 万 tCON 储备
async function deployFixture() {
  const [owner, alice, bob, carol, dave, eve, frank, grace] = await ethers.getSigners();
  const TestCON = await ethers.getContractFactory('TestCON');
  const con = await TestCON.deploy(ethers.parseEther('10000000'));
  const Bank = await ethers.getContractFactory('NBTStakingBankV3');
  const bank = await Bank.deploy(con.target, con.target, owner.address, FEE);
  // 给每个用户发币
  for (const u of [alice, bob, carol, dave, eve, frank, grace]) {
    await con.transfer(u.address, ethers.parseEther('1000000'));
  }
  // 邀请奖励走独立储备入口（严重-1 修复）：先转币再 fundInvitePool 入账额度
  await con.transfer(bank.target, ethers.parseEther('1000000'));
  await con.connect(owner).approve(bank.target, ethers.MaxUint256);
  await bank.fundInvitePool(ethers.parseEther('1000000'));
  return { con, bank, owner, alice, bob, carol, dave, eve, frank, grace };
}

// 用户质押 helper：先授权 + 付交互费
async function stakeAs(bank, con, user, amount, referrer) {
  await con.connect(user).approve(bank.target, ethers.MaxUint256);
  await bank.connect(user).stake(amount, referrer, { value: FEE });
}

// 造 10 个节点（每人质押 100，referrer 指向不质押的账户；调高门槛避免邀请奖励产生额外节点）
async function setup10Nodes(bank, con) {
  const signers = await ethers.getSigners();
  const users = signers.slice(0, 10);
  const ref = signers[19];
  for (const u of users) await con.transfer(u.address, ethers.parseEther('1000'));
  await bank.setMinReferralStakeValue(ethers.parseEther('1000'));
  for (let i = 0; i < 10; i++) {
    await stakeAs(bank, con, users[i], ethers.parseEther('100'), ref.address);
  }
  return users;
}

// 快进时间
const advance = async (seconds) => { await time.increase(seconds); };

describe('NBTStakingBankV3 合约逻辑测试', function () {
  describe('部署与初始状态', function () {
    it('构造参数校验：零代币/零收币地址 revert', async function () {
      const [owner] = await ethers.getSigners();
      const TestCON = await ethers.getContractFactory('TestCON');
      const con = await TestCON.deploy(1);
      const Bank = await ethers.getContractFactory('NBTStakingBankV3');
      await expect(Bank.deploy(ZERO, con.target, owner.address, FEE)).to.be.revertedWithCustomError(Bank, 'InvalidToken');
      await expect(Bank.deploy(con.target, con.target, ZERO, FEE)).to.be.revertedWithCustomError(Bank, 'InvalidFeeReceiver');
    });

    it('初始参数正确：owner / 邀请奖励 100 / 门槛 100U / 汇率 1 / 交互费', async function () {
      const { bank, owner } = await loadFixture(deployFixture);
      expect(await bank.owner()).to.equal(owner.address);
      expect(await bank.inviteReward()).to.equal(ethers.parseEther('100'));
      expect(await bank.minReferralStakeValue()).to.equal(ethers.parseEther('100'));
      expect(await bank.stakeValueRate()).to.equal(ethers.parseEther('1'));
      expect(await bank.interactionFee()).to.equal(FEE);
      expect(await bank.feeReceiver()).to.equal(owner.address);
      expect(await bank.paused()).to.equal(false);
      expect(await bank.getRankedNodeCount()).to.equal(0);
    });
  });

  describe('质押规则', function () {
    it('未绑定推荐人质押 revert（MustBindReferrer）', async function () {
      const { bank, con, alice } = await loadFixture(deployFixture);
      await con.connect(alice).approve(bank.target, ethers.MaxUint256);
      await expect(bank.connect(alice).stake(ethers.parseEther('100'), ZERO, { value: FEE }))
        .to.be.revertedWithCustomError(bank, 'MustBindReferrer');
    });

    it('不能自己推荐自己', async function () {
      const { bank, con, alice } = await loadFixture(deployFixture);
      await con.connect(alice).approve(bank.target, ethers.MaxUint256);
      await expect(bank.connect(alice).stake(ethers.parseEther('100'), alice.address, { value: FEE }))
        .to.be.revertedWithCustomError(bank, 'CannotSelfRefer');
    });

    it('不能形成循环推荐链 A→B→C→A', async function () {
      const { bank, con, alice, bob, carol } = await loadFixture(deployFixture);
      for (const u of [alice, bob, carol]) await con.connect(u).approve(bank.target, ethers.MaxUint256);
      // alice -> bob, bob -> carol
      await bank.connect(alice).stake(ethers.parseEther('100'), bob.address, { value: FEE });
      await bank.connect(bob).stake(ethers.parseEther('100'), carol.address, { value: FEE });
      // carol -> alice 形成循环
      await expect(bank.connect(carol).stake(ethers.parseEther('100'), alice.address, { value: FEE }))
        .to.be.revertedWithCustomError(bank, 'CircularReferral');
    });

    it('推荐人已绑定后传入不同推荐人 revert（ReferrerMismatch）', async function () {
      const { bank, con, alice, bob, carol } = await loadFixture(deployFixture);
      await con.connect(alice).approve(bank.target, ethers.MaxUint256);
      await bank.connect(alice).stake(ethers.parseEther('100'), bob.address, { value: FEE });
      await expect(bank.connect(alice).stake(ethers.parseEther('100'), carol.address, { value: FEE }))
        .to.be.revertedWithCustomError(bank, 'ReferrerMismatch');
    });

    it('金额为 0 revert（InvalidAmount）', async function () {
      const { bank, con, alice, bob } = await loadFixture(deployFixture);
      await con.connect(alice).approve(bank.target, ethers.MaxUint256);
      await expect(bank.connect(alice).stake(0, bob.address, { value: FEE }))
        .to.be.revertedWithCustomError(bank, 'InvalidAmount');
    });

    it('正常质押：代币入合约、记录写入、计分正确（1 CON = 1 U）', async function () {
      const { bank, con, alice, bob } = await loadFixture(deployFixture);
      await stakeAs(bank, con, alice, ethers.parseEther('500'), bob.address);
      const st = await bank.getStakeRecord(alice.address, 0);
      expect(st.amount).to.equal(ethers.parseEther('500'));
      expect(st.scoreValue).to.equal(ethers.parseEther('500'));
      expect(st.active).to.equal(true);
      expect(await bank.getNodeRank(alice.address)).to.equal(1);
      const info = await bank.getUserInfo(alice.address);
      expect(info.info.personalStakeVolume).to.equal(ethers.parseEther('500'));
      expect(info.info.activeStakeCount).to.equal(1);
      expect(await bank.totalStaked()).to.equal(ethers.parseEther('500'));
    });

    it('交互费（BNB）收取给 feeReceiver，多付的部分退还', async function () {
      const { bank, con, alice, bob, owner } = await loadFixture(deployFixture);
      const feeBefore = await ethers.provider.getBalance(owner.address);
      const aliceBefore = await ethers.provider.getBalance(alice.address);
      await con.connect(alice).approve(bank.target, ethers.MaxUint256);
      // 多付 0.1 ETH
      await bank.connect(alice).stake(ethers.parseEther('100'), bob.address, { value: FEE + ethers.parseEther('0.1') });
      const feeAfter = await ethers.provider.getBalance(owner.address);
      const aliceAfter = await ethers.provider.getBalance(alice.address);
      // owner 收到恰好一笔 fee（扣除 alice 消耗的 gas 后仍可验证大致）
      expect(feeAfter - feeBefore).to.equal(FEE);
      // alice 多付部分被退还（仅验证 gas 后余额差额在合理范围）
      expect(aliceBefore - aliceAfter).to.be.lt(ethers.parseEther('0.02'));
    });

    it('交互费不足 revert（InsufficientBnbFee）', async function () {
      const { bank, con, alice, bob } = await loadFixture(deployFixture);
      await con.connect(alice).approve(bank.target, ethers.MaxUint256);
      await expect(bank.connect(alice).stake(ethers.parseEther('100'), bob.address, { value: FEE - 1n }))
        .to.be.revertedWithCustomError(bank, 'InsufficientBnbFee');
    });

    it('单地址最多 50 笔活跃质押（TooManyActiveStakes）', async function () {
      const { bank, con, alice, bob } = await loadFixture(deployFixture);
      for (let i = 0; i < 50; i++) {
        await stakeAs(bank, con, alice, ethers.parseEther('1'), bob.address);
      }
      await expect(stakeAs(bank, con, alice, ethers.parseEther('1'), bob.address))
        .to.be.revertedWithCustomError(bank, 'TooManyActiveStakes');
    });

    it('U 本位计分：配置汇率 2 后 1 CON = 2 U', async function () {
      const { bank, con, alice, bob, owner } = await loadFixture(deployFixture);
      await bank.setStakeValueRate(ethers.parseEther('2'));
      await stakeAs(bank, con, alice, ethers.parseEther('300'), bob.address);
      const st = await bank.getStakeRecord(alice.address, 0);
      expect(st.scoreValue).to.equal(ethers.parseEther('600'));
      expect(await bank.getNodeRank(alice.address)).to.equal(1);
      const [, scores] = await bank.getRankedNodes(0, 10);
      expect(scores[0]).to.equal(ethers.parseEther('600'));
    });

    it('priceFeed 模式：以链上价格折算 U 价值', async function () {
      const { bank, con, alice, bob, owner } = await loadFixture(deployFixture);
      // 用一个返回固定价格的 mock
      const mock = await (await ethers.getContractFactory('MockPriceFeed')).deploy(ethers.parseEther('2'));
      await bank.setPriceFeed(mock.target);
      await stakeAs(bank, con, alice, ethers.parseEther('100'), bob.address);
      const st = await bank.getStakeRecord(alice.address, 0);
      expect(st.scoreValue).to.equal(ethers.parseEther('200'));
      await bank.setPriceFeed(ZERO);
    });

    it('priceFeed 价格为 0 时质押 revert（InvalidPrice）', async function () {
      const { bank, con, alice, bob, owner } = await loadFixture(deployFixture);
      const mock = await (await ethers.getContractFactory('MockPriceFeed')).deploy(0);
      await bank.setPriceFeed(mock.target);
      await con.connect(alice).approve(bank.target, ethers.MaxUint256);
      await expect(bank.connect(alice).stake(ethers.parseEther('100'), bob.address, { value: FEE }))
        .to.be.revertedWithCustomError(bank, 'InvalidPrice');
    });

    it('合约可接收原生 ETH（receive）', async function () {
      const { bank, owner } = await loadFixture(deployFixture);
      await owner.sendTransaction({ to: bank.target, value: ethers.parseEther('1') });
      expect(await ethers.provider.getBalance(bank.target)).to.equal(ethers.parseEther('1'));
    });
  });

  describe('邀请奖励', function () {
    it('被邀请人质押满 100U → 邀请人锁定 100 CON 奖励', async function () {
      const { bank, con, alice, bob } = await loadFixture(deployFixture);
      // alice 被 bob 邀请，质押 100
      await stakeAs(bank, con, alice, ethers.parseEther('100'), bob.address);
      const info = await bank.getUserInfo(bob.address);
      expect(info.info.directReferrals).to.equal(1);
      expect(info.info.lockedInviteRewards).to.equal(ethers.parseEther('100'));
      // 锁定记录
      const locks = await bank.getInviteRewardLocks(bob.address);
      expect(locks.amounts[0]).to.equal(ethers.parseEther('100'));
      expect(locks.unlockTimes[0]).to.equal((await time.latest()) + DAYS(15));
      expect(await bank.qualifiedReferral(bob.address, alice.address)).to.equal(true);
      // pendingRewardAll 仍为 0（未解锁）
      const info2 = await bank.getUserInfo(bob.address);
      expect(info2.pendingRewards).to.equal(0);
    });

    it('未达门槛（<100U）不触发邀请奖励', async function () {
      const { bank, con, alice, bob } = await loadFixture(deployFixture);
      await stakeAs(bank, con, alice, ethers.parseEther('99'), bob.address);
      const info = await bank.getUserInfo(bob.address);
      expect(info.info.directReferrals).to.equal(0);
      expect(info.info.lockedInviteRewards).to.equal(0);
      expect(await bank.qualifiedReferral(bob.address, alice.address)).to.equal(false);
    });

    it('同一对邀请关系只发一次', async function () {
      const { bank, con, alice, bob } = await loadFixture(deployFixture);
      await stakeAs(bank, con, alice, ethers.parseEther('100'), bob.address);
      await stakeAs(bank, con, alice, ethers.parseEther('500'), bob.address);
      const info = await bank.getUserInfo(bob.address);
      expect(info.info.directReferrals).to.equal(1);
      expect(info.info.lockedInviteRewards).to.equal(ethers.parseEther('100'));
      expect((await bank.getInviteRewardLocks(bob.address)).amounts.length).to.equal(1);
    });

    it('储备不足时整笔质押回滚（NoInviteReserve）', async function () {
      const [owner, alice, bob] = await ethers.getSigners();
      const TestCON = await ethers.getContractFactory('TestCON');
      const con = await TestCON.deploy(ethers.parseEther('1000'));
      await con.transfer(alice.address, ethers.parseEther('500'));
      const Bank = await ethers.getContractFactory('NBTStakingBankV3');
      const bank = await Bank.deploy(con.target, con.target, owner.address, FEE);
      // 不给合约任何储备，质押会因邀请奖励 reserve 不足回滚
      await con.connect(alice).approve(bank.target, ethers.MaxUint256);
      await expect(bank.connect(alice).stake(ethers.parseEther('100'), bob.address, { value: FEE }))
        .to.be.revertedWithCustomError(bank, 'NoInviteReserve');
      // 整笔回滚：合约余额和 totalStaked 都为 0
      expect(await con.balanceOf(bank.target)).to.equal(0);
      expect(await bank.totalStaked()).to.equal(0);
    });

    it('15 天后邀请奖励解锁，可领取（claimNodeRewards）', async function () {
      const { bank, con, alice, bob } = await loadFixture(deployFixture);
      await stakeAs(bank, con, alice, ethers.parseEther('100'), bob.address);
      await advance(DAYS(15) + 1);
      // 账本未动（lockedInviteRewards 仍为 100），但视图 pendingRewards 已解锁可领
      const info = await bank.getUserInfo(bob.address);
      expect(info.info.lockedInviteRewards).to.equal(ethers.parseEther('100'));
      expect(info.pendingRewards).to.equal(ethers.parseEther('100'));
      // 领取
      const before = await con.balanceOf(bob.address);
      await bank.connect(bob).claimNodeRewards({ value: FEE });
      const after = await con.balanceOf(bob.address);
      expect(after - before).to.equal(ethers.parseEther('100'));
      const info2 = await bank.getUserInfo(bob.address);
      expect(info2.info.lockedInviteRewards).to.equal(0);
      expect(info2.info.pendingInviteRewards).to.equal(0);
      expect(info2.info.totalInviteClaimed).to.equal(ethers.parseEther('100'));
    });

    it('无可领取奖励时领取 revert（NoRewards）', async function () {
      const { bank, alice } = await loadFixture(deployFixture);
      await expect(bank.connect(alice).claimNodeRewards({ value: FEE }))
        .to.be.revertedWithCustomError(bank, 'NoRewards');
    });
  });

  describe('排行榜与节点计分', function () {
    it('节点分数 = 个人质押 + 邀请质押，降序排列', async function () {
      const { bank, con, alice, bob, carol, dave } = await loadFixture(deployFixture);
      // alice→bob：alice 质押 500，bob 得邀请分 500
      await stakeAs(bank, con, alice, ethers.parseEther('500'), bob.address);
      // bob→carol：bob 质押 100，bob=600(100+500)，carol 得邀请分 100
      await stakeAs(bank, con, bob, ethers.parseEther('100'), carol.address);
      // carol→dave：carol 质押 200，carol=300(200+100)，dave 得邀请分 200
      await stakeAs(bank, con, carol, ethers.parseEther('200'), dave.address);
      const [nodes, scores] = await bank.getRankedNodes(0, 10);
      // bob:600 > alice:500 > carol:300 > dave:200
      expect(nodes[0]).to.equal(bob.address);
      expect(scores[0]).to.equal(ethers.parseEther('600'));
      expect(nodes[1]).to.equal(alice.address);
      expect(scores[1]).to.equal(ethers.parseEther('500'));
      expect(nodes[2]).to.equal(carol.address);
      expect(scores[2]).to.equal(ethers.parseEther('300'));
      expect(nodes[3]).to.equal(dave.address);
      expect(scores[3]).to.equal(ethers.parseEther('200'));
    });

    it('提取本金后分数下降、排名下降', async function () {
      const { bank, con, alice, bob, carol, dave } = await loadFixture(deployFixture);
      // alice→bob：alice 质押 100，bob 得邀请分 100
      await stakeAs(bank, con, alice, ethers.parseEther('100'), bob.address);
      // bob→carol：bob 质押 100，bob=200，carol 得邀请分 100
      await stakeAs(bank, con, bob, ethers.parseEther('100'), carol.address);
      // carol→dave：carol 质押 100，carol=200，dave 得邀请分 100
      await stakeAs(bank, con, carol, ethers.parseEther('100'), dave.address);
      // 榜：bob 200, carol 200, alice 100, dave 100
      let [nodes, scores] = await bank.getRankedNodes(0, 10);
      expect(nodes[0]).to.equal(bob.address);
      expect(scores[0]).to.equal(ethers.parseEther('200'));
      expect(nodes[1]).to.equal(carol.address);
      // bob 提取本金：bob 分数 200 -> 100（只剩邀请分）；同时 carol 的邀请分扣减 200 -> 100
      await advance(DAYS(15) + 1);
      await bank.connect(bob).withdraw(0, { value: FEE });
      const [nodes2, scores2] = await bank.getRankedNodes(0, 10);
      // 4 人全部并列 100；bob 先更新下沉（此时 carol 未扣分仍在 bob 前），故 bob 排名 2
      expect(scores2[0]).to.equal(ethers.parseEther('100'));
      expect(await bank.getNodeRank(bob.address)).to.equal(2);
      expect(scores2[1]).to.equal(ethers.parseEther('100'));
      expect(scores2[2]).to.equal(ethers.parseEther('100'));
      // carol 邀请分已被扣减：carol 从 200 降到 100
      const carolInfo = await bank.getUserInfo(carol.address);
      expect(carolInfo.info.referralStakeVolume).to.equal(ethers.parseEther('0'));
      expect(carolInfo.info.personalStakeVolume).to.equal(ethers.parseEther('100'));
    });

    it('分数归零的节点自动退出排行榜', async function () {
      const { bank, con, alice, bob } = await loadFixture(deployFixture);
      await stakeAs(bank, con, alice, ethers.parseEther('100'), bob.address);
      expect(await bank.getNodeRank(alice.address)).to.equal(1);
      await advance(DAYS(15) + 1);
      await bank.connect(alice).withdraw(0, { value: FEE });
      expect(await bank.getNodeRank(alice.address)).to.equal(0);
      expect(await bank.getRankedNodeCount()).to.equal(0);
    });

    it('未到期提取 revert（LockNotEnded）', async function () {
      const { bank, con, alice, bob } = await loadFixture(deployFixture);
      await stakeAs(bank, con, alice, ethers.parseEther('100'), bob.address);
      await expect(bank.connect(alice).withdraw(0, { value: FEE }))
        .to.be.revertedWithCustomError(bank, 'LockNotEnded');
    });

    it('重复提取 revert（StakeNotActive）', async function () {
      const { bank, con, alice, bob } = await loadFixture(deployFixture);
      await stakeAs(bank, con, alice, ethers.parseEther('100'), bob.address);
      await advance(DAYS(15) + 1);
      await bank.connect(alice).withdraw(0, { value: FEE });
      await expect(bank.connect(alice).withdraw(0, { value: FEE }))
        .to.be.revertedWithCustomError(bank, 'StakeNotActive');
    });
  });

  describe('15 天结算周期（开期/注资/领取/结转）', function () {
    it('openEpoch 权限：非管理员 revert（NotAdmin）', async function () {
      const { bank, alice } = await loadFixture(deployFixture);
      await expect(bank.connect(alice).openEpoch()).to.be.revertedWithCustomError(bank, 'NotAdmin');
    });

    it('节点不足 10 个时 openEpoch 自动标记 disabled（合并），可立即结算且未领结转下期', async function () {
      const { bank, con, owner, alice, bob } = await loadFixture(deployFixture);
      await stakeAs(bank, con, alice, ethers.parseEther('100'), bob.address);
      await bank.openEpoch();
      const ep = await bank.getEpoch(1);
      expect(ep.disabled).to.equal(true);
      expect(ep.totalNodes).to.equal(2); // alice + bob 都在榜（bob 有邀请分）
      // 注资
      await con.connect(owner).approve(bank.target, ethers.MaxUint256);
      await bank.fundEpoch(ethers.parseEther('1000'));
      // disabled 期可直接结算，未领全部结转
      await bank.settleEpoch();
      expect(await bank.pendingCarryover()).to.equal(ethers.parseEther('1000'));
    });

    it('openEpoch 快照当前节点；新质押不会影响已开期的快照', async function () {
      const { bank, con, alice, bob, carol } = await loadFixture(deployFixture);
      await stakeAs(bank, con, alice, ethers.parseEther('100'), bob.address);
      await bank.openEpoch();
      const ep = await bank.getEpoch(1);
      expect(ep.totalNodes).to.equal(2);
      // 开期后新用户质押
      await stakeAs(bank, con, carol, ethers.parseEther('500'), bob.address);
      const ep2 = await bank.getEpoch(1);
      expect(ep2.totalNodes).to.equal(2); // 快照不变
      expect(await bank.getRankedNodeCount()).to.equal(3); // 实时榜有 3 个
    });

    it('开期后注资（fundEpoch）；未开期注资 revert（NoActiveEpoch）', async function () {
      const { bank, con, owner, alice, bob } = await loadFixture(deployFixture);
      await expect(bank.fundEpoch(ethers.parseEther('100')))
        .to.be.revertedWithCustomError(bank, 'NoActiveEpoch');
      await stakeAs(bank, con, alice, ethers.parseEther('100'), bob.address);
      await bank.openEpoch();
      await con.connect(owner).approve(bank.target, ethers.MaxUint256);
      await bank.fundEpoch(ethers.parseEther('1000'));
      const ep = await bank.getEpoch(1);
      expect(ep.poolAmount).to.equal(ethers.parseEther('1000'));
      // settled 后不能注资
      await advance(DAYS(11));
      await bank.settleEpoch();
      await expect(bank.fundEpoch(ethers.parseEther('100')))
        .to.be.revertedWithCustomError(bank, 'EpochAlreadySettled');
    });

    it('展示期（3 天）内不能领取排名分红（OutOfClaimWindow）', async function () {
      const { bank, con, owner } = await loadFixture(deployFixture);
      const users = await setup10Nodes(bank, con);
      await bank.openEpoch();
      await con.connect(owner).approve(bank.target, ethers.MaxUint256);
      await bank.fundEpoch(ethers.parseEther('1000'));
      await expect(bank.connect(users[0])['claimEpochReward()']({ value: FEE }))
        .to.be.revertedWithCustomError(bank, 'OutOfClaimWindow');
    });

    it('领取期（3 天展示 + 7 天领取）内可领取，重复领取 revert（AlreadyClaimed）', async function () {
      const { bank, con, owner } = await loadFixture(deployFixture);
      const users = await setup10Nodes(bank, con);
      await bank.openEpoch();
      await con.connect(owner).approve(bank.target, ethers.MaxUint256);
      await bank.fundEpoch(ethers.parseEther('1000'));
      await advance(DAYS(3) + 1);
      // 10 用户 + referrer 共 11 节点 => ≤50 档：前 10 名拿 50% 平分，每人 500/10 = 50
      const preview = await bank.pendingEpochReward(1, users[0].address);
      expect(preview).to.equal(ethers.parseEther('50'));
      const before = await con.balanceOf(users[0].address);
      await bank.connect(users[0])['claimEpochReward()']({ value: FEE });
      const after = await con.balanceOf(users[0].address);
      expect(after - before).to.equal(ethers.parseEther('50'));
      expect(await bank.hasClaimed(1, users[0].address)).to.equal(true);
      await expect(bank.connect(users[0])['claimEpochReward()']({ value: FEE }))
        .to.be.revertedWithCustomError(bank, 'AlreadyClaimed');
    });

    it('领取期结束后未领部分结转 pendingCarryover，下一期自动带入奖池', async function () {
      const { bank, con, owner, alice, bob } = await loadFixture(deployFixture);
      await stakeAs(bank, con, alice, ethers.parseEther('100'), bob.address);
      await bank.openEpoch();
      await con.connect(owner).approve(bank.target, ethers.MaxUint256);
      await bank.fundEpoch(ethers.parseEther('1000'));
      await advance(DAYS(11)); // 领取期结束
      await bank.settleEpoch();
      expect(await bank.pendingCarryover()).to.equal(ethers.parseEther('1000'));
      // 下一期 openEpoch 自动带入
      await bank.openEpoch();
      const ep2 = await bank.getEpoch(2);
      expect(ep2.poolAmount).to.equal(ethers.parseEther('1000'));
      expect(await bank.pendingCarryover()).to.equal(0);
    });

    it('claim 期未结束不能结算（ClaimPeriodNotEnded）', async function () {
      const { bank, con } = await loadFixture(deployFixture);
      const users = await setup10Nodes(bank, con);
      await bank.openEpoch();
      await expect(bank.settleEpoch()).to.be.revertedWithCustomError(bank, 'ClaimPeriodNotEnded');
    });

    it('disabled（合并）期领取 revert（PoolMerged）', async function () {
      const { bank, con, alice, bob } = await loadFixture(deployFixture);
      await stakeAs(bank, con, alice, ethers.parseEther('100'), bob.address);
      await bank.openEpoch(); // 2 节点 < 10 → disabled
      const ep = await bank.getEpoch(1);
      expect(ep.disabled).to.equal(true);
      await expect(bank.connect(alice)['claimEpochReward()']({ value: FEE }))
        .to.be.revertedWithCustomError(bank, 'PoolMerged');
    });

    it('领取不存在的期 revert（NoSuchEpoch）', async function () {
      const { bank, alice } = await loadFixture(deployFixture);
      await expect(bank.connect(alice)['claimEpochReward(uint256)'](999, { value: FEE }))
        .to.be.revertedWithCustomError(bank, 'NoSuchEpoch');
    });

    it('带参 claimEpochReward(epochId) 可领取指定期', async function () {
      const { bank, con, owner } = await loadFixture(deployFixture);
      const users = await setup10Nodes(bank, con);
      await bank.openEpoch();
      await con.connect(owner).approve(bank.target, ethers.MaxUint256);
      await bank.fundEpoch(ethers.parseEther('1000'));
      await advance(DAYS(3) + 1);
      const before = await con.balanceOf(users[0].address);
      await bank.connect(users[0])['claimEpochReward(uint256)'](1, { value: FEE });
      const after = await con.balanceOf(users[0].address);
      expect(after - before).to.equal(ethers.parseEther('50'));
    });
  });

  describe('分红档位权重（_rankShare）', function () {
    const POOL = ethers.parseEther('10000');
    it('≤10 节点：前 10 名平分 100%，合计 = 奖池', async function () {
      const { bank } = await loadFixture(deployFixture);
      let sum = 0n;
      for (let r = 1; r <= 10; r++) {
        const share = await bank.getRankRewardPreview(POOL, 10, r);
        sum += share;
      }
      expect(sum).to.equal(POOL);
    });

    it('≤50 节点：前 10 拿 50%、11-50 拿 50%，同档等分 + 尾差兜底', async function () {
      const { bank } = await loadFixture(deployFixture);
      let top10 = 0n, rest = 0n;
      for (let r = 1; r <= 10; r++) top10 += await bank.getRankRewardPreview(POOL, 50, r);
      for (let r = 11; r <= 50; r++) rest += await bank.getRankRewardPreview(POOL, 50, r);
      expect(top10).to.equal(ethers.parseEther('5000'));
      expect(rest).to.equal(ethers.parseEther('5000'));
    });

    it('≤100 节点：50% / 30% / 20%，合计 = 奖池', async function () {
      const { bank } = await loadFixture(deployFixture);
      let t0 = 0n, t1 = 0n, t2 = 0n;
      for (let r = 1; r <= 10; r++) t0 += await bank.getRankRewardPreview(POOL, 100, r);
      for (let r = 11; r <= 50; r++) t1 += await bank.getRankRewardPreview(POOL, 100, r);
      for (let r = 51; r <= 100; r++) t2 += await bank.getRankRewardPreview(POOL, 100, r);
      expect(t0).to.equal(ethers.parseEther('5000'));
      expect(t1).to.equal(ethers.parseEther('3000'));
      expect(t2).to.equal(ethers.parseEther('2000'));
    });

    it('>100 节点：50% / 30% / 15% / 5%，合计 = 奖池', async function () {
      const { bank } = await loadFixture(deployFixture);
      let t0 = 0n, t1 = 0n, t2 = 0n, t3 = 0n;
      for (let r = 1; r <= 10; r++) t0 += await bank.getRankRewardPreview(POOL, 101, r);
      for (let r = 11; r <= 50; r++) t1 += await bank.getRankRewardPreview(POOL, 101, r);
      for (let r = 51; r <= 100; r++) t2 += await bank.getRankRewardPreview(POOL, 101, r);
      for (let r = 101; r <= 101; r++) t3 += await bank.getRankRewardPreview(POOL, 101, r);
      expect(t0).to.equal(ethers.parseEther('5000'));
      expect(t1).to.equal(ethers.parseEther('3000'));
      expect(t2).to.equal(ethers.parseEther('1500'));
      expect(t3).to.equal(ethers.parseEther('500'));
      // 合计 = 奖池
      const sum = t0 + t1 + t2 + t3;
      expect(sum).to.equal(POOL);
    });

    it('每档最后一名兜底尾差，保证 100% 分完（奇数池）', async function () {
      const { bank } = await loadFixture(deployFixture);
      const pool = ethers.parseEther('10001');
      let sum = 0n;
      for (let r = 1; r <= 10; r++) sum += await bank.getRankRewardPreview(pool, 10, r);
      expect(sum).to.equal(pool);
    });

    it('rank 越界返回 0', async function () {
      const { bank } = await loadFixture(deployFixture);
      expect(await bank.getRankRewardPreview(POOL, 10, 11)).to.equal(0);
      expect(await bank.getRankRewardPreview(POOL, 10, 0)).to.equal(0);
      expect(await bank.getRankRewardPreview(POOL, 0, 1)).to.equal(0);
    });
  });

  describe('一键复投（三源）', function () {
    it('复投 = 解锁邀请奖励 + 排名分红 + 到期本金，且免费', async function () {
      const { bank, con, owner } = await loadFixture(deployFixture);
      const signers = await ethers.getSigners();
      const users = signers.slice(0, 10);
      const ref = signers[19];
      for (const u of users) await con.transfer(u.address, ethers.parseEther('1000'));
      // 链式推荐：u0→u1(bob), u1→u2, ..., u8→u9, u9→ref
      // bob(u1) 被 u0 邀请 → 锁定 100 邀请奖励；u1 质押 100 → 本金；11 节点 ≥10 不 disabled
      for (let i = 0; i < 10; i++) {
        const r = i < 9 ? users[i + 1].address : ref.address;
        await stakeAs(bank, con, users[i], ethers.parseEther('100'), r);
      }
      // 时间线设计：质押在 T0，开期推迟到 T0+6d，使领取窗口 [T0+9d, T0+16d)
      // 与邀请解锁/本金到期（T0+15d）重叠，三源可同时复投
      await advance(DAYS(6));
      await bank.openEpoch();
      await con.connect(owner).approve(bank.target, ethers.MaxUint256);
      await bank.fundEpoch(ethers.parseEther('1000'));
      await advance(DAYS(9)); // 现在 = T0+15d：邀请解锁 ✓ 本金到期 ✓ 领取窗口内 ✓
      const bob = users[1];
      const preview = await bank.getReinvestPreview(bob.address);
      expect(preview.inviteAmount).to.equal(ethers.parseEther('100')); // 被 u0 邀请的奖励
      expect(preview.principalAmount).to.equal(ethers.parseEther('100'));
      expect(preview.rankAmount).to.equal(ethers.parseEther('50')); // 11 节点档位：前10 拿50%，bob rank2 → 50
      expect(preview.totalAmount).to.equal(ethers.parseEther('250'));
      // 复投（不带 value，免费）
      const balanceBefore = await con.balanceOf(bob.address);
      await bank.connect(bob).reinvest(ZERO);
      const st = await bank.getStakeRecord(bob.address, 1);
      expect(st.active).to.equal(true);
      expect(st.amount).to.equal(preview.totalAmount);
      // 免费：复投不转出本金也不收交互费（tCON 余额不变）
      const balanceAfter = await con.balanceOf(bob.address);
      expect(balanceAfter).to.equal(balanceBefore);
      const st0 = await bank.getStakeRecord(bob.address, 0);
      expect(st0.active).to.equal(false);
    });

    it('无可复投资产时复投 revert（NoReinvestableAssets）', async function () {
      const { bank, con, alice, bob } = await loadFixture(deployFixture);
      await stakeAs(bank, con, alice, ethers.parseEther('100'), bob.address);
      await expect(bank.connect(alice).reinvest(ZERO))
        .to.be.revertedWithCustomError(bank, 'NoReinvestableAssets');
    });

    it('未绑定推荐人复投 revert（MustBindReferrer）', async function () {
      const { bank, alice } = await loadFixture(deployFixture);
      await expect(bank.connect(alice).reinvest(ZERO))
        .to.be.revertedWithCustomError(bank, 'MustBindReferrer');
    });
  });

  describe('管理功能', function () {
    it('参数修改仅 owner 可调用', async function () {
      const { bank, con, alice } = await loadFixture(deployFixture);
      await expect(bank.connect(alice).setInviteReward(1)).to.be.revertedWithCustomError(bank, 'NotOwner');
      await expect(bank.connect(alice).setMinReferralStakeValue(1)).to.be.revertedWithCustomError(bank, 'NotOwner');
      await expect(bank.connect(alice).setStakeValueRate(1)).to.be.revertedWithCustomError(bank, 'NotOwner');
      await expect(bank.connect(alice).setPriceFeed(alice.address)).to.be.revertedWithCustomError(bank, 'NotOwner');
      await expect(bank.connect(alice).setOperator(alice.address, true)).to.be.revertedWithCustomError(bank, 'NotOwner');
      await expect(bank.connect(alice).setInteractionFeeConfig(ZERO, 1, alice.address)).to.be.revertedWithCustomError(bank, 'NotOwner');
    });

    it('汇率设为 0 revert（InvalidRate）', async function () {
      const { bank } = await loadFixture(deployFixture);
      await expect(bank.setStakeValueRate(0)).to.be.revertedWithCustomError(bank, 'InvalidRate');
    });

    it('owner 不能把自己设为 operator（OwnerIsSuperAdmin）', async function () {
      const { bank, owner } = await loadFixture(deployFixture);
      await expect(bank.setOperator(owner.address, true)).to.be.revertedWithCustomError(bank, 'OwnerIsSuperAdmin');
    });

    it('operator 可以执行开期/注资/结算/暂停', async function () {
      const { bank, con, alice, bob, carol } = await loadFixture(deployFixture);
      await bank.setOperator(carol.address, true);
      await stakeAs(bank, con, alice, ethers.parseEther('100'), bob.address);
      await bank.connect(carol).openEpoch();
      // fundEpoch 从 msg.sender（carol）转币，需 carol 授权
      await con.connect(carol).approve(bank.target, ethers.MaxUint256);
      await bank.connect(carol).fundEpoch(ethers.parseEther('500'));
      await advance(DAYS(11));
      await bank.connect(carol).settleEpoch();
      // 暂停
      await bank.connect(carol).pause();
      expect(await bank.paused()).to.equal(true);
      await expect(stakeAs(bank, con, bob, ethers.parseEther('10'), alice.address))
        .to.be.revertedWithCustomError(bank, 'ContractPaused');
      await bank.connect(carol).unpause();
      expect(await bank.paused()).to.equal(false);
    });

    it('暂停时无法开期/质押/提取', async function () {
      const { bank, con, owner, alice, bob } = await loadFixture(deployFixture);
      await stakeAs(bank, con, alice, ethers.parseEther('100'), bob.address);
      await bank.pause();
      await expect(bank.openEpoch()).to.be.revertedWithCustomError(bank, 'ContractPaused');
      await expect(bank.connect(alice).withdraw(0, { value: FEE })).to.be.revertedWithCustomError(bank, 'ContractPaused');
    });

    it('recoverWrongToken：不能回收质押/奖励/交互费币', async function () {
      const { bank, con, alice } = await loadFixture(deployFixture);
      await expect(bank.recoverWrongToken(con.target, alice.address, 1))
        .to.be.revertedWithCustomError(bank, 'CannotRecoverStakingToken');
    });

    it('所有权转移：transferOwnership + acceptOwnership', async function () {
      const { bank, alice, bob } = await loadFixture(deployFixture);
      await bank.transferOwnership(alice.address);
      // 非 pendingOwner（bob）不能接受
      await expect(bank.connect(bob).acceptOwnership()).to.be.revertedWithCustomError(bank, 'NotNewOwner');
      // pendingOwner（alice）可以接受
      await bank.connect(alice).acceptOwnership();
      expect(await bank.owner()).to.equal(alice.address);
      expect(await bank.pendingOwner()).to.equal(ZERO);
    });

    it('交互费可切换为 ERC20 代币模式', async function () {
      const { bank, con, owner, alice, bob } = await loadFixture(deployFixture);
      await bank.setInteractionFeeConfig(con.target, ethers.parseEther('5'), owner.address);
      // ERC20 交互费模式下 msg.value != 0 revert
      await con.connect(alice).approve(bank.target, ethers.MaxUint256);
      await expect(bank.connect(alice).stake(ethers.parseEther('100'), bob.address, { value: FEE }))
        .to.be.revertedWithCustomError(bank, 'UnexpectedBnb');
      // 不带 value 正常（交互费 5 tCON 从 alice 扣）
      const ownerBefore = await con.balanceOf(owner.address);
      await bank.connect(alice).stake(ethers.parseEther('100'), bob.address);
      const ownerAfter = await con.balanceOf(owner.address);
      expect(ownerAfter - ownerBefore).to.equal(ethers.parseEther('5'));
    });
  });

  describe('缺陷修复回归（F01-F10）', function () {
    it('F01：disabled 合并期奖池被储备预留，低储备不再资不抵债', async function () {
      const [owner, alice, bob, carol, dave, eve] = await ethers.getSigners();
      const TestCON = await ethers.getContractFactory('TestCON');
      const con = await TestCON.deploy(ethers.parseEther('2000'));
      await con.transfer(alice.address, ethers.parseEther('500'));
      await con.transfer(bob.address, ethers.parseEther('500'));
      await con.transfer(carol.address, ethers.parseEther('200'));
      await con.transfer(dave.address, ethers.parseEther('200'));
      await con.transfer(eve.address, ethers.parseEther('200'));
      const Bank = await ethers.getContractFactory('NBTStakingBankV3');
      const bank = await Bank.deploy(con.target, con.target, owner.address, FEE);
      // 无储备。alice/bob/carol 各质押 1（低于门槛，不触发邀请奖励），链式绑定
      await stakeAs(bank, con, alice, 1n, bob.address);
      await stakeAs(bank, con, bob, 1n, carol.address);
      await stakeAs(bank, con, carol, 1n, dave.address);
      // 开期（节点 <10 → disabled）+ 注资 100
      await bank.openEpoch();
      await con.connect(owner).approve(bank.target, ethers.MaxUint256);
      await bank.fundEpoch(ethers.parseEther('100'));
      // 新用户 eve 质押 100 触发 dave 的 100 CON 邀请奖励：
      // 修复后 disabled 期奖池被预留，可用储备=0 → 整笔回滚，避免资不抵债
      await con.connect(eve).approve(bank.target, ethers.MaxUint256);
      await expect(bank.connect(eve).stake(ethers.parseEther('100'), dave.address, { value: FEE }))
        .to.be.revertedWithCustomError(bank, 'NoInviteReserve');
    });

    it('F04：领取期开始后禁止追加注资（ClaimWindowStarted）', async function () {
      const { bank, con, owner } = await loadFixture(deployFixture);
      const users = await setup10Nodes(bank, con);
      await bank.openEpoch();
      await con.connect(owner).approve(bank.target, ethers.MaxUint256);
      await bank.fundEpoch(ethers.parseEther('1000')); // 展示期内注资 OK
      await advance(DAYS(3) + 1); // 进入领取期
      await expect(bank.fundEpoch(ethers.parseEther('500')))
        .to.be.revertedWithCustomError(bank, 'ClaimWindowStarted');
      // disabled 期（合并）不设领取窗口，仍可注资
      const { bank: b2, con: c2, owner: o2 } = await loadFixture(deployFixture);
      await stakeAs(b2, c2, (await ethers.getSigners())[2], ethers.parseEther('1'), (await ethers.getSigners())[3].address);
      await b2.openEpoch();
      await c2.connect(o2).approve(b2.target, ethers.MaxUint256);
      await b2.fundEpoch(ethers.parseEther('10'));
    });

    it('F07：getRankClaimed 累计排名分红', async function () {
      const { bank, con, owner } = await loadFixture(deployFixture);
      const users = await setup10Nodes(bank, con);
      await bank.openEpoch();
      await con.connect(owner).approve(bank.target, ethers.MaxUint256);
      await bank.fundEpoch(ethers.parseEther('1000'));
      await advance(DAYS(3) + 1);
      expect(await bank.getRankClaimed(users[0].address)).to.equal(0);
      await bank.connect(users[0])['claimEpochReward()']({ value: FEE });
      expect(await bank.getRankClaimed(users[0].address)).to.equal(ethers.parseEther('50'));
      // 复投路径也累计：users[1] 用 reinvest 领取排名分红
      const prev = await bank.getRankClaimed(users[1].address);
      const preview = await bank.getReinvestPreview(users[1].address);
      if (preview.rankAmount > 0n && preview.inviteAmount + preview.rankAmount + preview.principalAmount > 0n) {
        await bank.connect(users[1]).reinvest(ZERO);
        expect(await bank.getRankClaimed(users[1].address)).to.equal(prev + preview.rankAmount);
      }
    });

    it('F08：21 层推荐环被拒绝（深度上限后仍检测链尾）', async function () {
      const { bank, con } = await loadFixture(deployFixture);
      const signers = await ethers.getSigners();
      // 取 21 个账户：A0→A1→...→A20 链式绑定（共 20 层绑定），最后一次 A20→A0 形成 21 层环
      const users = signers.slice(0, 21);
      for (const u of users) await con.transfer(u.address, ethers.parseEther('100'));
      // 前 20 个：Ai 绑定 referrer=Ai+1（A0→A1...A19→A20），各自质押 1（不触发邀请，避免负债干扰）
      await bank.setMinReferralStakeValue(ethers.parseEther('1000'));
      for (let i = 0; i < 20; i++) {
        await stakeAs(bank, con, users[i], 1n, users[i + 1].address);
      }
      // A20 尝试绑定 A0（21 层环）：F08 修复后应拒绝
      await con.connect(users[20]).approve(bank.target, ethers.MaxUint256);
      await expect(bank.connect(users[20]).stake(1n, users[0].address, { value: FEE }))
        .to.be.revertedWithCustomError(bank, 'CircularReferral');
    });

    it('F09：零计分本金复投不保留旧质押单、不重复计算本金', async function () {
      const { bank, con, alice, bob } = await loadFixture(deployFixture);
      await bank.setStakeValueRate(1); // 1 CON = 1e-18 U，质押 1 wei 计分为 0
      await stakeAs(bank, con, alice, 1n, bob.address);
      const st0 = await bank.getStakeRecord(alice.address, 0);
      expect(st0.scoreValue).to.equal(0n);
      await advance(DAYS(15) + 1);
      await bank.connect(alice).reinvest(bob.address);
      // 旧单关闭，totalStaked 只有新单 1 wei，不翻倍
      const st0b = await bank.getStakeRecord(alice.address, 0);
      expect(st0b.active).to.equal(false);
      expect(await bank.totalStaked()).to.equal(1n);
      const info = await bank.getUserInfo(alice.address);
      expect(info.info.activeStakeCount).to.equal(1);
    });

    it('F10：档间舍入尾差全部分配（11 节点、101 wei 奖池）', async function () {
      const { bank } = await loadFixture(deployFixture);
      const pool = 101n;
      let sum = 0n;
      for (let r = 1; r <= 11; r++) {
        sum += await bank.getRankRewardPreview(pool, 11, r);
      }
      expect(sum).to.equal(pool);
      // 4 档场景（101 节点）同样 100% 分完
      const pool2 = 10001n;
      let sum2 = 0n;
      for (let r = 1; r <= 101; r++) {
        sum2 += await bank.getRankRewardPreview(pool2, 101, r);
      }
      expect(sum2).to.equal(pool2);
    });

    it('严重-1：排名池注资不挤占邀请储备（独立 fundInvitePool）', async function () {
      const { bank, con, owner, alice, bob } = await loadFixture(deployFixture);
      const poolBefore = await bank.inviteRewardPool();
      // 大额注资排名奖池
      await bank.openEpoch();
      await bank.fundEpoch(ethers.parseEther('500000'));
      // 排名池注资后，邀请储备额度不变
      expect(await bank.inviteRewardPool()).to.equal(poolBefore);
      // 邀请奖励仍可正常发放（不被排名池挤占）
      await stakeAs(bank, con, alice, ethers.parseEther('100'), bob.address);
      expect((await bank.getUserInfo(bob.address)).info.lockedInviteRewards).to.equal(ethers.parseEther('100'));
    });

    it('严重-1：fundInvitePool 权限与额度扣减', async function () {
      const { bank, con, owner, alice, bob } = await loadFixture(deployFixture);
      // 非管理员不能注资
      await con.connect(alice).approve(bank.target, ethers.MaxUint256);
      await expect(bank.connect(alice).fundInvitePool(1)).to.be.revertedWithCustomError(bank, 'NotAdmin');
      // 管理员注资：额度增加
      const before = await bank.inviteRewardPool();
      await bank.fundInvitePool(ethers.parseEther('500'));
      expect(await bank.inviteRewardPool()).to.equal(before + ethers.parseEther('500'));
      // 发放邀请奖励后额度扣减
      await stakeAs(bank, con, alice, ethers.parseEther('100'), bob.address);
      const afterQualify = await bank.inviteRewardPool();
      expect(afterQualify).to.equal(before + ethers.parseEther('500') - ethers.parseEther('100'));
    });
  });
});
