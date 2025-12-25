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

  const fromTokenAddress = (req.query.fromTokenAddress || '').toString().trim();
  const toTokenAddress = (req.query.toTokenAddress || '').toString().trim();
  const amount = (req.query.amount || '').toString().trim();

  if (!fromTokenAddress || !toTokenAddress || !amount) {
    res.status(400).json({ error: 'Missing parameters: fromTokenAddress, toTokenAddress, amount' });
    return;
  }

  // 层1: 1inch
  try {
    const inchUrl = `https://api.1inch.dev/swap/v6.1/42161/quote?fromTokenAddress=${fromTokenAddress}&toTokenAddress=${toTokenAddress}&amount=${amount}`;
    const inchResponse = await fetch(inchUrl, {
      headers: {
        Authorization: `Bearer ${process.env.ONEINCH_API_KEY}`,
        Accept: 'application/json',
      },
    });
    const inchData = await inchResponse.json();
    if (inchResponse.ok && inchData.toAmount) {
      res.status(200).json(inchData);
      return;
    }
  } catch (err) {
    console.warn('1inch quote failed, trying KyberSwap');
  }

  // 层2: KyberSwap
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
    if (kyberResponse.ok && kyberData.data?.routeSummary?.amountOut) {
      // 统一返回结构供前端兼容
      res.status(200).json({
        toAmount: kyberData.data.routeSummary.amountOut,
        fromAmount: amount,
        route: kyberData.data,
        aggregator: 'KyberSwap',
      });
      return;
    }
  } catch (err) {
    console.warn('KyberSwap quote failed, trying 0x');
  }

  // 层3: 0x Swap API
  try {
    let sellToken = fromTokenAddress;
    let buyToken = toTokenAddress;
    if (sellToken.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') sellToken = 'ETH';
    if (buyToken.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') buyToken = 'ETH';

    const zeroXUrl = `https://arbitrum.api.0x.org/swap/v1/quote?sellToken=${encodeURIComponent(sellToken)}&buyToken=${encodeURIComponent(buyToken)}&sellAmount=${amount}`;
    const zeroXResponse = await fetch(zeroXUrl);
    const zeroXData = await zeroXResponse.json();

    if (zeroXResponse.ok && zeroXData.buyAmount) {
      res.status(200).json({
        toAmount: zeroXData.buyAmount,
        fromAmount: amount,
        route: zeroXData,
        aggregator: '0x',
      });
      return;
    }
  } catch (err) {
    console.warn('0x quote failed');
  }

  // 所有聚合器均失败
  res.status(404).json({ error: 'No route found from any aggregator' });
}

export const config = {
  api: {
    externalResolver: true,
  },
};
