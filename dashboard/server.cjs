/**
 * CON 伞下业绩看板 —— 后端服务
 *
 * 设计要点：
 *  - 只读链上数据，不需要私钥，不发起任何交易
 *  - 爬取结果带缓存：浏览器永远读缓存（秒回），后台定时刷新
 *  - 密码保护：伞下业绩属商业敏感数据，不做公开访问
 *  - 爬取失败保留上一次成功结果，并暴露错误，不会静默展示空数据
 */
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { runReport } = require('./crawler.cjs');

const PORT = Number(process.env.PORT || 3030);
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || '';
const CONTRACT = process.env.CONTRACT || '0x0B3943E0851341164D859DB56B6502c786EC8000';
const DEPTH = Number(process.env.DEPTH || 20);
const MAX_NODES = Number(process.env.MAX_NODES || 50000);
const REFRESH_MINUTES = Number(process.env.REFRESH_MINUTES || 10);
const RPC_URL = process.env.RPC_URL || '';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const LEADERS_FILE = path.join(DATA_DIR, 'leaders.txt');
const CACHE_FILE = path.join(DATA_DIR, 'cache.json');

if (!ACCESS_PASSWORD) {
  console.error('❌ 未设置 ACCESS_PASSWORD 环境变量，拒绝启动（防止数据裸奔）');
  process.exit(1);
}

fs.mkdirSync(DATA_DIR, { recursive: true });

// 每次启动生成新的会话令牌：重启后旧 cookie 自动失效
const SESSION_TOKEN = crypto.randomBytes(32).toString('hex');
const COOKIE_NAME = 'con_auth';
const COOKIE_MAX_AGE = 12 * 60 * 60 * 1000; // 12 小时

const safeEqual = (a, b) => {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
};

function readLeaders() {
  if (!fs.existsSync(LEADERS_FILE)) return [];
  const seen = new Set();
  const out = [];
  for (const line of fs.readFileSync(LEADERS_FILE, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    if (!/^0x[0-9a-fA-F]{40}$/.test(t)) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

// ---------------- 缓存与后台刷新 ----------------
let cache = {
  ok: false,
  refreshing: false,
  lastError: null,
  lastSuccessAt: null,
  data: null,
};

// 启动时载入磁盘缓存，重启后秒开（不用等一轮爬取）
try {
  if (fs.existsSync(CACHE_FILE)) {
    const saved = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    cache.data = saved.data;
    cache.lastSuccessAt = saved.lastSuccessAt;
    cache.ok = !!saved.data;
  }
} catch (err) {
  console.error('载入磁盘缓存失败:', err.message);
}

async function refresh(reason) {
  if (cache.refreshing) return { skipped: true, reason: '已有刷新任务在执行' };

  const leaders = readLeaders();
  if (leaders.length === 0) {
    cache.lastError = `团队长名单为空，请编辑 ${LEADERS_FILE}（每行一个地址）`;
    console.error(cache.lastError);
    return { skipped: true, reason: cache.lastError };
  }

  cache.refreshing = true;
  console.log(`[刷新] 触发原因: ${reason}，团队长 ${leaders.length} 个`);
  const t0 = Date.now();
  try {
    const data = await runReport({
      leaders,
      contractAddress: CONTRACT,
      depth: DEPTH,
      maxNodes: MAX_NODES,
      rpcUrl: RPC_URL,
    });
    cache.data = data;
    cache.lastSuccessAt = new Date().toISOString();
    cache.lastError = null;
    cache.ok = true;
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ data, lastSuccessAt: cache.lastSuccessAt }));
    console.log(
      `[刷新] 成功：${data.rows.length} 个团队长，读取 ${data.addressesRead} 个地址，` +
      `区块 #${data.block}，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`
    );
  } catch (err) {
    // 关键：失败时保留上一次成功结果，只暴露错误，不把看板清空
    cache.lastError = err.shortMessage || err.message || String(err);
    console.error('[刷新] 失败（保留上次结果）:', cache.lastError);
  } finally {
    cache.refreshing = false;
  }
  return { skipped: false };
}

// ---------------- HTTP ----------------
const app = express();
app.disable('x-powered-by');
app.use(express.json());

function requireAuth(req, res, next) {
  const token = req.headers.cookie
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE_NAME}=`))
    ?.slice(COOKIE_NAME.length + 1);
  if (token && safeEqual(token, SESSION_TOKEN)) return next();
  res.status(401).json({ ok: false, error: '未登录或登录已过期' });
}

app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
  if (!password || !safeEqual(password, ACCESS_PASSWORD)) {
    return res.status(401).json({ ok: false, error: '密码错误' });
  }
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${SESSION_TOKEN}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE / 1000}`
  );
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  res.json({ ok: true });
});

app.get('/api/session', requireAuth, (req, res) => res.json({ ok: true }));

app.get('/api/report', requireAuth, (req, res) => {
  res.json({
    ok: cache.ok,
    refreshing: cache.refreshing,
    lastError: cache.lastError,
    lastSuccessAt: cache.lastSuccessAt,
    data: cache.data,
  });
});

app.post('/api/refresh', requireAuth, async (req, res) => {
  // 不阻塞请求：后台跑，前端轮询 /api/report 拿结果
  refresh('手动触发').catch((e) => console.error(e));
  res.json({ ok: true, started: true });
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, '127.0.0.1', () => {
  console.log(`CON 伞下业绩看板已启动: http://127.0.0.1:${PORT}`);
  console.log(`合约: ${CONTRACT}   深度: ${DEPTH}   刷新间隔: ${REFRESH_MINUTES} 分钟`);
  if (!fs.existsSync(LEADERS_FILE)) {
    fs.writeFileSync(
      LEADERS_FILE,
      '# 团队长地址名单，每行一个，# 开头为注释\n# 改完文件后在页面上点「刷新数据」即可生效，无需重启\n'
    );
    console.log(`已创建名单文件，请编辑后刷新: ${LEADERS_FILE}`);
  }
  refresh('服务启动');
});

setInterval(() => refresh('定时刷新'), REFRESH_MINUTES * 60 * 1000);
