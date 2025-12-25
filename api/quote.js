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

  let sellToken = (req.query.fromTokenAddress || '').toString().trim();
  let buyToken = (req.query.toTokenAddress || '').toString().trim();
  const sellAmount = (req.query.amount || '').toString().trim();

  if (!sellToken || !buyToken || !sellAmount) {
    res.status(400).json({ error: 'Missing parameters: fromTokenAddress, toTokenAddress, amount' });
    return;
  }

  // 0x 使用 ETH 而非 0xeee... 地址
  if (sellToken.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
    sellToken = 'ETH';
  }
  if (buyToken.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
    buyToken = 'ETH';
  }

  // 0x API 基 URL（Arbitrum 使用专用子域）
  const baseUrl = chainId === 42161 ? 'https://arbitrum.api.0x.org' : 'https://api.0x.org';

  const url = `${baseUrl}/swap/v1/quote?sellToken=${encodeURIComponent(sellToken)}&buyToken=${encodeURIComponent(buyToken)}&sellAmount=${sellAmount}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      res.status(response.status).json({
        error: data.validation?.errors?.[0]?.reason || data.reason || '0x quote failed',
        status: response.status,
      });
      return;
    }

    res.status(200).json(data);
  } catch (error) {
    console.error('0x quote proxy error:', error);
    res.status(500).json({ error: 'Internal proxy error' });
  }
}

export const config = {
  api: {
    externalResolver: true,
  },
};
