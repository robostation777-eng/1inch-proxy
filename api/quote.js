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

  const fromTokenAddress = (req.query.fromTokenAddress || '').toString().trim().toLowerCase();
  const toTokenAddress = (req.query.toTokenAddress || '').toString().trim().toLowerCase();
  const amount = (req.query.amount || '').toString().trim();

  if (!fromTokenAddress || !toTokenAddress || !amount) {
    res.status(400).json({ error: 'Missing parameters' });
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
      res.status(200).json({
        ...inchData,
        aggregator: '1inch',
      });
      return;
    }
  } catch (err) {
    console.warn('1inch quote failed, trying KyberSwap');
  }

  // 层2: KyberSwap
  try {
    let tokenIn = fromTokenAddress;
    let tokenOut = toTokenAddress;
    if (tokenIn === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') tokenIn = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
    if (tokenOut === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') tokenOut = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

    const kyberUrl = `https://aggregator-api.kyberswap.com/arbitrum/api/v1/routes?tokenIn=${tokenIn}&tokenOut=${tokenOut}&amountIn=${amount}`;
    const kyberResponse = await fetch(kyberUrl, {
      headers: { 'x-client-id': 'RBS DApp' },
    });
    const kyberData = await kyberResponse.json();
    if (kyberResponse.ok && kyberData.data?.routeSummary?.amountOut) {
      res.status(200).json({
        toAmount: kyberData.data.routeSummary.amountOut,
        fromAmount: amount,
        route: kyberData.data,
        aggregator: 'KyberSwap',
      });
      return;
    }
  } catch (err) {
    console.warn('KyberSwap quote failed, trying OpenOcean');
  }

  // 层3: OpenOcean (低流动性支持优秀)
  try {
    const openOceanUrl = `https://open-api.openocean.finance/v3/arb/getQuote?inTokenAddress=${fromTokenAddress}&outTokenAddress=${toTokenAddress}&amount=${amount}&gasPrice=5&slippage=100`; // slippage 1%
    const openOceanResponse = await fetch(openOceanUrl);
    const openOceanData = await openOceanResponse.json();
    if (openOceanResponse.ok && openOceanData.data && openOceanData.data.outAmount) {
      res.status(200).json({
        toAmount: openOceanData.data.outAmount,
        fromAmount: amount,
        route: openOceanData.data,
        aggregator: 'OpenOcean',
      });
      return;
    }
  } catch (err) {
    console.warn('OpenOcean quote failed');
  }

  // 所有聚合器均失败
  res.status(404).json({ error: 'No route found from any aggregator' });
}

export const config = {
  api: {
    externalResolver: true,
  },
};
