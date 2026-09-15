# CON 伞下业绩看板 · 部署说明

> 访问地址：**http://154.89.195.153:8090**（**公开访问，无需密码**）
> 部署时间：2026-09-15
> 服务器：HK-VPS-05（154.89.195.153，CentOS Stream 9）

> ⚠️ **当前为公开模式**：任何拿到该地址的人都能看到全部团队长的伞下业绩。
> 页面已设置 `noindex, nofollow` 防止被搜索引擎收录，但地址一旦外传即无法收回。
> 若日后想恢复密码保护，见第 3.2 节。

---

## 一、这是什么

团队长伞下业绩的 Web 看板。合约只记录「直推（第一代）」数据，没有任何伞下聚合函数
（已核对全部 16 个 `get*` 视图函数），因此本服务在**链下递归遍历推荐树**，
把结果缓存后供页面展示，用于按业绩手工结算团队奖金。

**全程只读**：不持有私钥、不发起交易、不花 gas。

---

## 二、访问与使用

打开 http://154.89.195.153:8090 即可，**无需登录**。

页面内容：

| 区块 | 说明 |
|---|---|
| 顶部状态条 | 最后更新时间、快照区块号、团队长数量、本轮读取地址数与耗时 |
| 统计卡 | 团队长数量、伞下总人数合计、累计业绩合计、当前有效业绩合计 |
| 主表格 | 每位团队长一行：伞下人数、有效人数、累计业绩、当前有效业绩、直推人数 |
| 展开明细 | **点击任意一行**展开：各层级人数与业绩、团队长本人数据、完整地址 |
| 导出 CSV | 表格右上角按钮，导出含各层级双口径的完整数据，带快照区块号 |
| 刷新数据 | 手动触发后台重新爬取（不阻塞页面） |

### 两种业绩口径（务必先定清楚）

| 口径 | 合约字段 | 特点 |
|---|---|---|
| **累计业绩** | `totalStaked` | 只增不减，用户提取后仍计入 |
| **当前有效业绩** | `personalStakeVolume` | 被邀请人提取本金后会减少 |

> ⚠️ **团队长在自己页面上看到的「邀请质押价值」是【当前有效】口径。**
> 如果你按【累计】发奖，团队长会发现你给的数字比自己看到的多，容易起争议。
> 建议要么提前在群里说清按哪个口径，要么把两个数字都发给他。

---

## 三、日常维护

### 3.1 修改团队长名单（最常用）

```bash
ssh root@154.89.195.153
vi /opt/con-downline/data/leaders.txt
```

格式：每行一个地址，`#` 开头为注释行。**改完不需要重启**，
在网页上点「刷新数据」即可生效（服务每次刷新都会重新读取该文件）。

### 3.2 重新开启密码保护（当前为关闭状态）

访问控制由 `ACCESS_PASSWORD` 环境变量控制：**设了就要密码，留空就公开**。
当前该变量已从服务配置中移除，所以是公开的。要恢复密码保护：

```bash
ssh root@154.89.195.153
vi /etc/systemd/system/con-downline.service
```

在 `[Service]` 段加一行（把 `你的新密码` 换成实际密码）：

```ini
Environment=ACCESS_PASSWORD=你的新密码
```

然后：

```bash
systemctl daemon-reload && systemctl restart con-downline
```

改完页面会重新出现登录框，所有人需要重新登录（会话令牌每次重启都会变）。

反之，想再次公开就把这一行删掉再重启。

### 3.3 常用运维命令

```bash
systemctl status con-downline      # 查看状态
systemctl restart con-downline     # 重启
journalctl -u con-downline -n 50   # 查看最近日志
journalctl -u con-downline -f      # 实时跟踪日志
```

### 3.4 调整爬取参数

在 `/etc/systemd/system/con-downline.service` 的 `Environment=` 中修改：

| 变量 | 当前值 | 说明 |
|---|---|---|
| `REFRESH_MINUTES` | 10 | 后台自动刷新间隔 |
| `DEPTH` | 20 | 遍历深度（合约上限 20 层） |
| `PORT` | 3030 | 本机监听端口，一般不用改 |
| `RPC_URL` | 内置 3 个公共节点 | 被限流时可换成自己的私有节点 |

改完 `systemctl daemon-reload && systemctl restart con-downline`。

---

## 四、技术架构

```
浏览器 ──► nginx :8090 ──► Node 服务 127.0.0.1:3030 ──► BSC 公共 RPC
                                │
                                └──► /opt/con-downline/data/cache.json（缓存）
```

| 组件 | 位置 |
|---|---|
| 程序目录 | `/opt/con-downline/` |
| 名单文件 | `/opt/con-downline/data/leaders.txt` |
| 缓存文件 | `/opt/con-downline/data/cache.json` |
| systemd 服务 | `/etc/systemd/system/con-downline.service` |
| nginx 配置 | `/etc/nginx/conf.d/con-downline.conf` |
| nginx 日志 | `/var/log/nginx/con-downline.*.log` |

设计要点：

- **浏览器只读缓存**，爬取在后台跑。伞下上千人时一轮要几分钟，不能让页面请求去等。
- **爬取失败保留上一次成功结果**，只在页面顶部显示红色错误横幅。结算场景下
  宁可展示旧数据并报警，也不能把看板清空让人误以为业绩归零。
- **快照区块固定**：一轮爬取内所有 RPC 调用带同一个 `blockTag`，同样参数重跑结果一致。
- 服务以专用系统用户 `conapp` 运行，非 root。

---

## 五、⚠️ 与服务器上其他项目共存

这台服务器（HK-VPS-05）**同时跑着多个互不相关的项目**：

| 项目 | 目录 | 入口 |
|---|---|---|
| xmr-plan | `/opt/xmr-plan` | 80 / 443，域名 xmrvip.com 与裸 IP |
| sol-create | `/opt/sol-create` | 8080 |
| huoxing-admin | `/opt/huoxing` | 127.0.0.1:3000 |
| ts-tg-bot | `/opt/ts-tg-bot` | — |
| **本看板** | `/opt/con-downline` | **8090** |

**维护时注意**：

- 不要动 `/etc/nginx/conf.d/` 下其他项目的配置文件
- 不要占用 80 / 443 / 8080 / 8443 / 8444 / 3000 / 3001 / 5176 / 5178 / 5181 / 5182 / 8787 / 4318
- 修改 `nginx.conf` 或执行 `nginx -t` 时留意其他站点的报错
- 本看板独占 **8090** 端口，已在 firewalld 中放行（运行时 + 持久化均已完成）

---

## 六、安全事项

### 6.1 🔴 服务器凭据必须更换

部署过程中，**服务器 root 密码与面板密码以明文形式出现在对话记录里**，
等同于完全泄露。请立即处理：

1. **改 root 密码**：`passwd`（或在服务商面板中重置）
2. **改面板密码**：登录服务商控制面板修改
3. 建议改用 **SSH 密钥登录**并关闭密码登录：
   ```bash
   # 本地生成密钥并上传后
   vi /etc/ssh/sshd_config      # PasswordAuthentication no
   systemctl restart sshd
   ```

在密码更换前，这台服务器（以及上面所有项目）都处于随时可被接管的状态。

### 6.2 看板当前是公开的

看板目前**没有访问控制**，任何人输入 `http://154.89.195.153:8090` 就能看到：

- 所有团队长的完整钱包地址
- 每位团队长的伞下总人数、各层级人数
- 每位团队长的伞下累计业绩与当前有效业绩
- 团队长本人质押量、直推人数与直推业绩

**这意味着你的整个推荐网络结构对外透明**：竞争对手可以看到谁是你的头部团队长、
每个人带来了多少业绩，据此定向挖人。

已做的缓解措施只有一条：页面加了 `<meta name="robots" content="noindex, nofollow">`，
搜索引擎不会收录。但**地址一旦被人转发出去就无法收回**。

如果只是想让团队长方便查自己的数据，更稳妥的做法是改成**每人独立链接**
（各自只能查自己的伞下），而不是把所有人数据公开。需要时告诉我，这个改造不难。

---

## 七、代码与版本管理

看板代码已纳入仓库 `dashboard/` 目录：

| 文件 | 说明 |
|---|---|
| `dashboard/server.cjs` | Express 服务：鉴权、缓存、后台刷新、API |
| `dashboard/crawler.cjs` | 推荐树遍历核心（与根目录 `con-downline-report.cjs` 同一套验证过的逻辑） |
| `dashboard/public/index.html` | 前端页面（单文件，无框架依赖） |

**服务器上的代码是手动上传的副本。改动流程**：本地改 → 提交 → 重新上传：

```bash
cd dashboard && tar czf /tmp/con-app.tar.gz --exclude=node_modules --exclude=data .
scp /tmp/con-app.tar.gz root@154.89.195.153:/tmp/
ssh root@154.89.195.153 'tar xzf /tmp/con-app.tar.gz -C /opt/con-downline && \
  cd /opt/con-downline && npm install --silent && \
  chown -R conapp:conapp /opt/con-downline && \
  systemctl restart con-downline'
```
