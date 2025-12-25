export default async function handler(req, res) {
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

  const chainId = parseInt(req.query.chainId || '42161', 10);
  const supportedChainIds = [1, 56, 137, 10, 42161, 8453];

  if (!supportedChainIds.includes(chainId)) {
    res.status(400).json({ error: 'Unsupported chainId' });
    return;
  }

  const params = new URLSearchParams(req.query);

  // 1. 优先 1inch
  try {
    const inchUrl = `https://api.1inch.dev/swap/v6.0/${chainId}/swap?${params.toString()}`;
    const inchResponse = await fetch(inchUrl, {
      headers: {
        'Authorization': `Bearer ${process.env.ONEINCH_API_KEY}`,
        'Accept': 'application/json',
      },
    });
    const inchData = await inchResponse.json();
    if (inchResponse.ok && inchData.tx) {
      res.status(200).json(inchData);
      return;
    }
  } catch (err) {
    console.warn('1inch swap failed, trying fallback');
  }

  // 2. fallback KyberSwap (需先 quote 获取 routeSummary，再 build)
  // 注意：KyberSwap swap 需要两步（quote + build），这里简化示例，前端需配合
  // 为完整性，这里省略详细 KyberSwap swap fallback（因复杂，建议前端处理）

  // 3. fallback 0x
  try {
    let sellToken = params.get('fromTokenAddress');
    let buyToken = params.get('toTokenAddress');
    if (sellToken.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') sellToken = 'ETH';
    if (buyToken.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') buyToken = 'ETH';

    const baseUrl = chainId === 42161 ? 'https://arbitrum.api.0x.org' : 'https://api.0x.org';
    const takerAddress = params.get('fromAddress');
    const slippagePercentage = params.get('slippage') || '0.5';
    const sellAmount = params.get('amount');

    const url = `${baseUrl}/swap/v1/quote?sellToken=${encodeURIComponent(sellToken)}&buyToken=${encodeURIComponent(buyToken)}&sellAmount=${sellAmount}&takerAddress=${takerAddress}&slippagePercentage=${slippagePercentage}`;

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) throw new Error('0x failed');

    res.status(200).json({
      tx: {
        to: data.to,
        data: data.data,
        value: data.value || '0',
        gas: data.gas,
        gasPrice: data.gasPrice,
      },
    });
    return;
  } catch (error) {
    console.error('All aggregators failed:', error);
    res.status(500).json({ error: 'All aggregators failed, fallback to Uniswap official' });
  }
}

export const config = {
  api: {
    externalResolver: true,
  },
};
