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

  let fromTokenAddress = (req.query.fromTokenAddress || '').toString().trim();
  let toTokenAddress = (req.query.toTokenAddress || '').toString().trim();
  const amount = (req.query.amount || '').toString().trim();

  if (!fromTokenAddress || !toTokenAddress || !amount) {
    res.status(400).json({ error: 'Missing parameters' });
    return;
  }

  // 1. 优先 1inch
  try {
    const inchUrl = `https://api.1inch.dev/swap/v6.0/${chainId}/quote?fromTokenAddress=${fromTokenAddress}&toTokenAddress=${toTokenAddress}&amount=${amount}`;
    const inchResponse = await fetch(inchUrl, {
      headers: {
        'Authorization': `Bearer ${process.env.ONEINCH_API_KEY}`,
        'Accept': 'application/json',
      },
    });
    const inchData = await inchResponse.json();
    if (inchResponse.ok && inchData.toAmount) {
      res.status(200).json(inchData);
      return;
    }
  } catch (err) {
    console.warn('1inch quote failed, trying fallback');
  }

  // 2. fallback KyberSwap
  try {
    let tokenIn = fromTokenAddress;
    let tokenOut = toTokenAddress;
    if (tokenIn.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') tokenIn = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
    if (tokenOut.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') tokenOut = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

    const kyberUrl = `https://aggregator-api.kyberswap.com/arbitrum/api/v1/routes?tokenIn=${tokenIn}&tokenOut=${tokenOut}&amountIn=${amount}`;
    const kyberResponse = await fetch(kyberUrl, {
      headers: { 'x-client-id': 'RBS DApp' },
    });
    const kyberData = await kyberResponse.json();
    if (kyberResponse.ok && kyberData.data && kyberData.data.routeSummary) {
      res.status(200).json({ kyber: kyberData.data }); // 前端需适配
      return;
    }
  } catch (err) {
    console.warn('KyberSwap quote failed, trying 0x');
  }

  // 3. fallback 0x
  try {
    let sellToken = fromTokenAddress;
    let buyToken = toTokenAddress;
    if (sellToken.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') sellToken = 'ETH';
    if (buyToken.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') buyToken = 'ETH';

    const baseUrl = chainId === 42161 ? 'https://arbitrum.api.0x.org' : 'https://api.0x.org';
    const url = `${baseUrl}/swap/v1/quote?sellToken=${encodeURIComponent(sellToken)}&buyToken=${encodeURIComponent(buyToken)}&sellAmount=${amount}`;

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) throw new Error('0x failed');

    res.status(200).json(data);
    return;
  } catch (error) {
    console.error('All aggregators failed:', error);
    res.status(500).json({ error: 'All aggregators failed, try Uniswap official' });
  }
}

export const config = {
  api: {
    externalResolver: true,
  },
};
