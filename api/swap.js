export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).end();
    return;
  }

  // 处理可能的 array 参数（Vercel/Next.js 有时会这样）
  // 同时对关键地址参数强制转小写（1inch API 严格要求小写）
  const queryParams = { ...req.query };

  // 辅助函数：安全取出字符串参数并处理 array/trim
  const getParam = (key) => {
    const value = queryParams[key];
    if (Array.isArray(value)) return value[0]?.toString().trim() || '';
    return value?.toString().trim() || '';
  };

  // 取出并强制小写地址参数（如果存在）
  if (queryParams.fromTokenAddress) {
    queryParams.fromTokenAddress = getParam('fromTokenAddress').toLowerCase();
  }
  if (queryParams.toTokenAddress) {
    queryParams.toTokenAddress = getParam('toTokenAddress').toLowerCase();
  }

  // 其他参数（如 amount, slippage, fromAddress 等）保持原样处理 array/trim
  Object.keys(queryParams).forEach((key) => {
    if (!['fromTokenAddress', 'toTokenAddress'].includes(key)) {
      queryParams[key] = getParam(key);
    }
  });

  // 可选：基础参数校验（防止空请求直接打 1inch，节省 quota）
  // 1inch swap 至少需要 fromTokenAddress, toTokenAddress, amount, fromAddress, slippage
  const required = ['fromTokenAddress', 'toTokenAddress', 'amount', 'fromAddress', 'slippage'];
  const missing = required.filter(key => !queryParams[key]);
  if (missing.length > 0) {
    res.status(400).json({ error: `Missing parameters: ${missing.join(', ')}` });
    return;
  }

  // 构建 URL
  const url = new URL('https://api.1inch.dev/v6.0/42161/swap');
  Object.keys(queryParams).forEach(key => {
    if (queryParams[key]) {
      url.searchParams.append(key, queryParams[key]);
    }
  });

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${process.env.ONEINCH_API_KEY}`,
      },
    });

    const data = await response.json();

    // 直接透传 1inch 的状态码和数据
    res.status(response.status).json(data);
  } catch (error) {
    console.error('1inch swap proxy error:', error); // 便于 Vercel logs 排查
    res.status(500).json({ error: 'Proxy error' });
  }
}

export const config = {
  api: {
    externalResolver: true,
  },
};
