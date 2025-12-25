export default async function handler(req, res) {
  // CORS 支持所有来源
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // 支持多链：从 query 获取 chainId，默认 42161
  const chainId = parseInt(req.query.chainId || '42161', 10);
  const supportedChainIds = [1, 56, 137, 10, 42161, 8453];

  if (!supportedChainIds.includes(chainId)) {
    res.status(400).json({ error: 'Unsupported chainId' });
    return;
  }

  // 必填参数
  const requiredParams = ['fromTokenAddress', 'toTokenAddress', 'amount', 'fromAddress', 'slippage'];
  const params = new URLSearchParams();

  for (const key of requiredParams) {
    let value = req.query[key];
    if (Array.isArray(value)) value = value[0];
    value = value?.toString().trim();

    if (!value) {
      res.status(400).json({ error: `Missing or invalid parameter: ${key}` });
      return;
    }

    if (key === 'fromTokenAddress' || key === 'toTokenAddress') {
      params.append(key, value.toLowerCase());
    } else {
      params.append(key, value);
    }
  }

  // 可选参数原样转发（排除 chainId）
  Object.keys(req.query).forEach((key) => {
    if (!requiredParams.includes(key) && key !== 'chainId') {
      let value = req.query[key];
      if (Array.isArray(value)) value = value[0];
      params.append(key, value?.toString().trim());
    }
  });

  // 使用稳定版本 v6.0
  const url = `https://api.1inch.dev/swap/v6.0/${chainId}/swap?${params.toString()}`;

  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${process.env.ONEINCH_API_KEY}`,
        'Accept': 'application/json',
      },
    });

    const data = await response.json();

    if (!response.ok) {
      res.status(response.status).json({
        error: data.description || data.message || '1inch swap failed',
        status: response.status,
      });
      return;
    }

    res.status(200).json(data);
  } catch (error) {
    console.error('1inch swap proxy error:', error);
    res.status(500).json({ error: 'Internal proxy error' });
  }
}

export const config = {
  api: {
    externalResolver: true,
  },
};
