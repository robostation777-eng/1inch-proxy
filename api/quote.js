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
  const chainId = parseInt(req.query.chainId || '42161', 10);
  const fromTokenAddress = (req.query.fromTokenAddress || '').toString().trim().toLowerCase();
  const toTokenAddress = (req.query.toTokenAddress || '').toString().trim().toLowerCase();
  const amount = (req.query.amount || '').toString().trim();
  const slippage = (req.query.slippage || '0.5').toString().trim(); // 支持动态 slippage
  if (!fromTokenAddress || !toTokenAddress || !amount) {
    res.status(400).json({ error: 'Missing parameters' });
    return;
  }
  // 链 slug 映射 (KyberSwap 和 OpenOcean 使用，已补充主流链)
  const chainSlugMap = {
    1: 'ethereum',
    56: 'bsc',
    137: 'polygon',
    10: 'optimism',
    42161: 'arbitrum',
    8453: 'base',
    324: 'zksync',
    100: 'gnosis',
    43114: 'avalanche',
    250: 'fantom',
    1313161554: 'aurora',
    8217: 'klaytn',
    59144: 'linea',
    81457: 'blast',
    7777777: 'zora',
    42220: 'celo',
    534352: 'scroll',
    5000: 'mantle',
    169: 'manta',
    34443: 'mode',
    3776: 'berachain',
  };
  const chainSlug = chainSlugMap[chainId] || 'arbitrum';

  // 层1: 1inch
  try {
    const inchUrl = `https://api.1inch.dev/swap/v6.1/${chainId}/quote?fromTokenAddress=${fromTokenAddress}&toTokenAddress=${toTokenAddress}&amount=${amount}`;
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
    const kyberUrl = `https://aggregator-api.kyberswap.com/${chainSlug}/api/v1/routes?tokenIn=${tokenIn}&tokenOut=${tokenOut}&amountIn=${amount}`;
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

  // 层3: OpenOcean
  try {
    const openOceanUrl = `https://open-api.openocean.finance/v3/${chainSlug}/quote?inTokenAddress=${fromTokenAddress}&outTokenAddress=${toTokenAddress}&amount=${amount}&gasPrice=5&slippage=100`;
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
    console.warn('OpenOcean quote failed, trying Uniswap API');
  }

  // 层4: Uniswap API
  try {
    const uniswapUrl = `https://api.uniswap.org/v1/quote?chainId=${chainId}&tokenInAddress=${fromTokenAddress}&tokenOutAddress=${toTokenAddress}&amount=${amount}`;
    const uniswapResponse = await fetch(uniswapUrl);
    const uniswapData = await uniswapResponse.json();
    if (uniswapResponse.ok && uniswapData.quote) {
      res.status(200).json({
        toAmount: uniswapData.quote,
        fromAmount: amount,
        route: uniswapData,
        aggregator: 'UniswapAPI',
      });
      return;
    }
  } catch (err) {
    console.warn('Uniswap API quote failed');
  }

  // 层5: Jupiter Quote API (专为 Solana 链添加，使用环境变量中的 API Key)
  if (chainId === 501) {
    try {
      const slippageBps = Math.round(Number(slippage) * 100);
      const jupiterUrl = `https://api.jup.ag/quote?inputMint=${fromTokenAddress}&outputMint=${toTokenAddress}&amount=${amount}&slippageBps=${slippageBps}`;
      const jupiterResponse = await fetch(jupiterUrl, {
        headers: {
          'x-api-key': process.env.JUPITER_API_KEY,
        },
      });
      if (!jupiterResponse.ok) {
        const errorText = await jupiterResponse.text();
        console.warn(`Jupiter quote failed with status ${jupiterResponse.status}: ${errorText}`);
      } else {
        const jupiterData = await jupiterResponse.json();
        if (jupiterData.outAmount) {
          res.status(200).json({
            toAmount: jupiterData.outAmount,
            fromAmount: amount,
            route: jupiterData,
            aggregator: 'Jupiter',
          });
          return;
        } else {
          console.warn('Jupiter returned no outAmount:', jupiterData);
        }
      }
    } catch (err) {
      console.warn('Jupiter quote exception:', err.message);
    }
  }

  // 所有聚合器均失败
  res.status(404).json({ error: 'No route found from any aggregator' });
}

export const config = {
  api: {
    externalResolver: true,
  },
};
