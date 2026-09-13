# CON 质押项目 · 合约储备充值教程

> 适用：BSC 主网质押合约 `0x0B3943E0851341164D859DB56B6502c786EC8000`
> 更新：2026-09-13

---

## 一、为什么要充值储备？

质押合约发邀请奖励（100 CON/人）时，会检查**独立邀请储备额度（inviteRewardPool）**：

- 储备额度 = 0 → 用户质押直接回滚（`NoInviteReserve`），**新用户无法质押**；
- 储备额度充足 → 每推荐一个达标用户，自动从额度里扣 100 CON 锁定给邀请人。

**储备不是直接转给合约地址就行**——必须调用 `fundInvitePool()` 把转账**记入额度**，否则合约不知道这笔币可以用于邀请奖励。

建议充值 **80 万 CON**：
| 用途 | 数量 |
|---|---|
| 邀请奖励负债（约 5000 人 × 100） | 50 万 |
| 奖池缓冲 | 20 万 |
| 机动 | 10 万 |

> 若还要打底池（1 BNB = 6 万 CON），额外再准备 6 万 CON。

---

## 二、推荐方式：转给部署钱包 + 跑脚本（一键）

### 第 1 步：把 CON 转到部署钱包

用持有 CON 的钱包（MetaMask/TokenPocket，切 **BNB Smart Chain 主网**），转账到：

```
0x39bB78BAdEC9d906CA77aF6b0882D0114263544F
```

数量：`800,000 CON`（如打底池则转 `860,000`）

> CON 代币合约地址（钱包里没有显示就手动添加）：
> `0x66A585556138EbBb44Da0fF1324C796C44eb5ED1`

### 第 2 步：运行注资脚本（在项目目录执行）

PowerShell：

```powershell
cd e:\dapp\质押项目\CON质押项目
$env:CON_DEPLOY_PRIVATE_KEY="0x部署钱包私钥"
node con-staking-deploy.cjs fund
```

脚本会自动：
1. `approve` 授权质押合约使用 CON；
2. 分 3 批调用 `fundInvitePool`：50 万 → 20 万 → 10 万；
3. 打印每笔交易哈希。

> 注意：**部署钱包私钥不要发给任何人**，只在本地环境变量中使用。

### 第 3 步：验证储备已入账

PowerShell：

```powershell
node con-staking-deploy.cjs status
```

看到类似 `邀请储备额度: 800000 CON` 即成功。之后新用户质押即可正常发放邀请奖励。

---

## 三、备用方式：直接在钱包/管理页操作

如果不想跑脚本，也可以手动调合约 `fundInvitePool`（部署钱包 = owner 或 operator 均可）：

1. 先在钱包里对质押合约授权 CON：`approve(0x0B3943..., 很大额度)`
2. 调用 `fundInvitePool(amount)`（amount 为要入账的 CON 数量，带 18 位小数，如 500000 → `500000000000000000000000`）
3. 每次调用都会触发 `InvitePoolFunded` 事件，额度实时增加

**前端管理页**：管理员钱包连接页面 → 管理 → 基金充值（若已加充值入口）可替代上述步骤。

---

## 四、常见问题

**Q1：我直接把 CON 转给合约地址了，为什么用户还是质押不了？**
转账只是让合约余额增加，但没有调用 `fundInvitePool` 记入额度，`inviteRewardPool` 仍为 0。需要部署钱包（或管理员）再调一次 `fundInvitePool` 补记额度。注意：直接转给合约的那笔币在 `recoverWrongToken` 保护之外（CON 是核心代币无法取出），所以**不要直接转合约**，务必走 `fundInvitePool`。

**Q2：fund 需要多少 BNB？**
3 笔交易约 0.001–0.003 BNB gas，部署钱包现有 0.018 BNB 足够。

**Q3：储备用完会怎样？**
`fundInvitePool` 额度归零后，新用户质押再次回滚 `NoInviteReserve`。运营需根据邀请活跃度定期补储备。

**Q4：排名奖池（fundEpoch）和邀请储备（fundInvitePool）是分开的吗？**
是的（已修复的历史问题）：排名奖池由 `fundEpoch` 注资、邀请奖励只从 `fundInvitePool` 额度发放，两者互不挤占。

---

## 五、合约与参数速查

| 项目 | 值 |
|---|---|
| 质押合约 | `0x0B3943E0851341164D859DB56B6502c786EC8000` |
| CON 代币 | `0x66A585556138EbBb44Da0fF1324C796C44eb5ED1` |
| 部署钱包（owner） | `0x39bB78BAdEC9d906CA77aF6b0882D0114263544F` |
| 交互费 | 0.00065118 BNB/笔 → `0x500F34Dd13c01E5277E0A2AF933eA83BDE51BC88` |
| 邀请奖励 / 门槛 | 100 CON / 100 U（固定汇率 1 CON = 1 U） |
| BscScan | https://bscscan.com/address/0x0B3943E0851341164D859DB56B6502c786EC8000 |
