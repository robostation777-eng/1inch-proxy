export default async function handler(req, res) {
  // CORS 支持跨域
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).end();
    return;
  }

  const queryParams = { ...req.query };

  const getParam = (key) => {
    const value = queryParams[key];
    if (Array.isArray(value)) return value[0]?.toString().trim() || '';
    return value?.toString().trim() || '';
  };

  if (queryParams.fromTokenAddress) {
    queryParams.fromTokenAddress = getParam('fromTokenAddress').toLowerCase();
  }
  if (queryParams.toTokenAddress) {
    queryParams.toTokenAddress = getParam('toTokenAddress').toLowerCase();
  }

  Object.keys(queryParams).forEach((key) => {
    if (!['fromTokenAddress', 'toTokenAddress'].includes(key)) {
      queryParams[key] = getParam(key);
    }
  });

  const required = ['fromTokenAddress', 'toTokenAddress', 'amount', 'fromAddress', 'slippage'];
  const missing = required.filter(key => !queryParams[key]);
  if (missing.length > 0) {
    res.status(400).json({ error: `Missing parameters: ${missing.join(', ')}` });
    return;
  }

  // 2025 年 12 月最新官方 endpoint (v6.1 + .io 域名)
  const url = new URL('https://api.1inch.io/v6.1/42161/swap');
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

    res.status(response.status).json(data);
  } catch (error) {
    console.error('1inch swap proxy error:', error);
    res.status(500).json({ error: 'Proxy error' });
  }
}

export const config = {
  api: {
    externalResolver: true,
  },
};
