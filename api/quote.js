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

  // 支持多链：从 query 获取 chainId，默认 42161 (Arbitrum)
  const chainId = parseInt(req.query.chainId || '42161', 10);
  const supportedChainIds = [1, 56, 137, 10, 42161, 8453];

  if (!supportedChainIds.includes(chainId)) {
    res.status(400).json({ error: 'Unsupported chainId' });
    return;
  }

  const fromTokenAddress = (req.query.fromTokenAddress || '').toString().toLowerCase().trim();
  const toTokenAddress = (req.query.toTokenAddress || '').toString().toLowerCase().trim();
  const amount = (req.query.amount || '').toString().trim();

  if (!fromTokenAddress || !toTokenAddress || !amount) {
    res.status(400).json({ error: 'Missing parameters: fromTokenAddress, toTokenAddress, amount' });
    return;
  }

  // 使用最新稳定版本 v6.0
  const url = `https://api.1inch.dev/swap/v6.0/${chainId}/quote?fromTokenAddress=${fromTokenAddress}&toTokenAddress=${toTokenAddress}&amount=${amount}`;

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
        error: data.description || data.message || '1inch quote failed',
        status: response.status,
      });
      return;
    }

    res.status(200).json(data);
  } catch (error) {
    console.error('1inch quote proxy error:', error);
    res.status(500).json({ error: 'Internal proxy error' });
  }
}

export const config = {
  api: {
    externalResolver: true,
  },
};
