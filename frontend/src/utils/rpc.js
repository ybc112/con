import { ethers } from 'ethers';

// ============================================================
// 多节点自动切换 Provider（对应后端 ReliableRpc 的前端版）
// 单次 JSON-RPC 调用失败（超时/网络抖动/coalesce 错误）时，
// 自动按顺序切换到下一个节点重试，全部失败才抛出错误。
// 避免单节点抖动导致「余额全 0 / 交易误报失败」。
// ============================================================

const RPC_NODE_ERROR_PATTERNS = [
  'could not coalesce',
  'coalesce error',
  'timeout',
  'timed out',
  'network',
  'connec',
  'socket',
  'fetch',
  'request failed',
  'bad gateway',
  '503',
  '502',
  '429',
  'invalid json',
  'could not',
  'missing response',
  'econnrefused',
  'econnreset',
  'enetunreach',
];

export const isRpcNodeError = (err) => {
  const msg = [
    err?.shortMessage,
    err?.message,
    err?.reason,
    err?.code !== undefined ? String(err.code) : '',
    typeof err === 'string' ? err : '',
  ].filter(Boolean).join(' ').toLowerCase();
  return RPC_NODE_ERROR_PATTERNS.some((p) => msg.includes(p));
};

export class MultiRpcProvider extends ethers.JsonRpcProvider {
  constructor(urls, options = {}) {
    super(urls[0], undefined, {
      staticNetwork: true,
      requestTimeout: options.requestTimeout || 8000,
    });
    this._rpcUrls = urls.filter(Boolean);
    this._rpcIndex = 0;
  }

  // ethers v6：send() -> _send(payload)，期望返回数组（单请求时 [body]）
  // 我们在这一层做多节点轮询：传输失败/节点故障（could not coalesce 等）自动切下一个 URL
  async _send(payload) {
    const errors = [];
    const startIndex = this._rpcIndex;

    for (let i = 0; i < this._rpcUrls.length; i++) {
      const url = this._rpcUrls[(startIndex + i) % this._rpcUrls.length];
      try {
        const body = await this._sendOnce(url, payload);
        // 记住当前可用节点，下次从它开始，减少无谓失败
        this._rpcIndex = (startIndex + i) % this._rpcUrls.length;
        return Array.isArray(body) ? body : [body];
      } catch (err) {
        errors.push(`${url}: ${err?.shortMessage || err?.message || err}`);
      }
    }

    const e = new Error(`All RPC nodes failed: ${errors.join(' | ')}`);
    e.code = 'ALL_RPC_FAILED';
    e.shortMessage = e.message;
    throw e;
  }

  async _sendOnce(url, payload) {
    // 兼容批量请求（Array payload）与单请求
    const isBatch = Array.isArray(payload);
    const body = isBatch ? payload : { ...payload };

    const fetchReq = new ethers.FetchRequest(url);
    fetchReq.body = JSON.stringify(body);
    fetchReq.setHeader('content-type', 'application/json');
    fetchReq.timeout = this.requestTimeout || 8000;

    const resp = await fetchReq.send();
    resp.assertOk();

    const parsed = resp.bodyJson;

    if (isBatch) {
      // 批量：任何一条为节点级错误则整体切换重试
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (item?.error) {
          const msg = item.error.message || '';
          if (isRpcNodeError({ shortMessage: msg }) || /could not coalesce/i.test(msg)) {
            const e = new Error(msg);
            e.shortMessage = msg;
            e.isRpcNodeError = true;
            throw e;
          }
        }
      }
      return items;
    }

    if (parsed?.error) {
      const msg = parsed.error.message || '';
      // 节点内部故障（coalesce 等）→ 切节点重试；业务 revert → 交给上层解析
      if (isRpcNodeError({ shortMessage: msg }) || /could not coalesce/i.test(msg)) {
        const e = new Error(msg);
        e.shortMessage = msg;
        e.isRpcNodeError = true;
        throw e;
      }
    }
    return parsed;
  }
}

// 便捷：等待交易确认，遇 RPC 抖动时用备用 provider 兜底查回执
export const waitTxConfirmed = async (tx, fallbackProvider, timeoutMs = 60000) => {
  try {
    const receipt = await tx.wait();
    return receipt;
  } catch (err) {
    // 只有 RPC 节点类错误才走兜底；真正的合约 revert 直接抛
    if (!isRpcNodeError(err) || !tx?.hash || !fallbackProvider) throw err;

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const receipt = await fallbackProvider.getTransactionReceipt(tx.hash);
        if (receipt) return receipt;
      } catch { /* 节点抖动，继续轮询 */ }
      await new Promise((r) => setTimeout(r, 2500));
    }
    throw err;
  }
};

export default MultiRpcProvider;
