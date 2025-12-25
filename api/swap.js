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
    let paramKey = key;
    let value = req.query[key === 'slippage' ? 'slippage' : key.replace('Address', 'Token').replace('fromAddress', 'takerAddress')];
    if (!value) {
      res.status(400).json({ error: `Missing or invalid parameter: ${key}` });
      return;
    }
    value = value.toString().trim();

    if (key === 'fromTokenAddress') paramKey = 'sellToken';
    if (key === 'toTokenAddress') paramKey = 'buyToken';
    if (key === 'amount') paramKey = 'sellAmount';
    if (key === 'fromAddress') paramKey = 'takerAddress';
    if (key === 'slippage') paramKey = 'slippagePercentage';

    // 0x 使用 ETH
    if (value.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
      value = 'ETH';
    }

    params.append(paramKey, value);
  }

  // 可选参数原样转发（排除 chainId）
  Object.keys(req.query).forEach((key) => {
    if (!requiredParams.includes(key) && key !== 'chainId') {
      let value = req.query[key];
      if (Array.isArray(value)) value = value[0];
      params.append(key, value?.toString().trim());
    }
  });

  // 0x API 基 URL
  const baseUrl = chainId === 42161 ? 'https://arbitrum.api.0x.org' : 'https://api.0x.org';

  const url = `${baseUrl}/swap/v1/quote?${params.toString()}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      res.status(response.status).json({
        error: data.validation?.errors?.[0]?.reason || data.reason || '0x swap failed',
        status: response.status,
      });
      return;
    }

    // 统一返回结构与前端兼容（类似 1inch 的 tx 字段）
    res.status(200).json({
      tx: {
        to: data.to,
        data: data.data,
        value: data.value || '0',
        gas: data.gas,
        gasPrice: data.gasPrice,
      },
    });
  } catch (error) {
    console.error('0x swap proxy error:', error);
    res.status(500).json({ error: 'Internal proxy error' });
  }
}

export const config = {
  api: {
    externalResolver: true,
  },
};
