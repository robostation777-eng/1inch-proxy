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
  const fromTokenAddress = (req.query.fromTokenAddress || '').toString().trim().toLowerCase();
  const toTokenAddress = (req.query.toTokenAddress || '').toString().trim().toLowerCase();
  const amount = (req.query.amount || '').toString().trim();
  const slippage = (req.query.slippage || '0.5').toString().trim();

  if (!fromTokenAddress || !toTokenAddress || !amount) {
    res.status(400).json({ error: 'Missing parameters' });
    return;
  }

  const chainSlugMap = {
    1: 'ethereum', 56: 'bsc', 137: 'polygon', 10: 'optimism', 42161: 'arbitrum',
    8453: 'base', 324: 'zksync', 100: 'gnosis', 43114: 'avalanche', 250: 'fantom',
    1313161554: 'aurora', 8217: 'klaytn', 59144: 'linea', 81457: 'blast',
    7777777: 'zora', 42220: 'celo', 534352: 'scroll', 5000: 'mantle',
    169: 'manta', 34443: 'mode', 3776: 'berachain',
  };
  const chainSlug = chainSlugMap[chainId] || 'arbitrum';

  let responseData = null;
  let aggregator = 'Unknown';

  // 优先级1: KyberSwap（支持 priceImpact）
  try {
    let tokenIn = fromTokenAddress === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' ? '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' : fromTokenAddress;
    let tokenOut = toTokenAddress === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' ? '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' : toTokenAddress;
    const kyberUrl = `https://aggregator-api.kyberswap.com/${chainSlug}/api/v1/routes?tokenIn=${tokenIn}&tokenOut=${tokenOut}&amountIn=${amount}`;
    const kyberResponse = await fetch(kyberUrl, { headers: { 'x-client-id': 'RBS DApp' } });
    const kyberData = await kyberResponse.json();
    if (kyberResponse.ok && kyberData.data?.routeSummary?.amountOut) {
      responseData = {
        toAmount: kyberData.data.routeSummary.amountOut,
        fromAmount: amount,
        priceImpact: kyberData.data.routeSummary.priceImpact || null,
      };
      aggregator = 'KyberSwap';
    }
  } catch (err) {
    console.warn('KyberSwap quote failed:', err.message);
  }

  // 优先级2: OpenOcean（支持 price_impact）
  if (!responseData) {
    try {
      const openOceanUrl = `https://open-api.openocean.finance/v3/${chainSlug}/quote?inTokenAddress=${fromTokenAddress}&outTokenAddress=${toTokenAddress}&amount=${amount}&gasPrice=5&slippage=100`;
      const openOceanResponse = await fetch(openOceanUrl);
      const openOceanData = await openOceanResponse.json();
      if (openOceanResponse.ok && openOceanData.data?.outAmount) {
        responseData = {
          toAmount: openOceanData.data.outAmount,
          fromAmount: amount,
          priceImpact: openOceanData.data.price_impact ? parseFloat(openOceanData.data.price_impact) : null,
        };
        aggregator = 'OpenOcean';
      }
    } catch (err) {
      console.warn('OpenOcean quote failed:', err.message);
    }
  }

  // 优先级3: 1inch（高可靠性 fallback）
  if (!responseData) {
    try {
      const inchUrl = `https://api.1inch.dev/swap/v6.1/${chainId}/quote?fromTokenAddress=${fromTokenAddress}&toTokenAddress=${toTokenAddress}&amount=${amount}`;
      const inchResponse = await fetch(inchUrl, {
        headers: { Authorization: `Bearer ${process.env.ONEINCH_API_KEY}`, Accept: 'application/json' },
      });
      const inchData = await inchResponse.json();
      if (inchResponse.ok && inchData.toAmount) {
        responseData = { toAmount: inchData.toAmount, fromAmount: amount };
        aggregator = '1inch';
      }
    } catch (err) {
      console.warn('1inch quote failed:', err.message);
    }
  }

  // 优先级4: Uniswap API
  if (!responseData) {
    try {
      const uniswapUrl = `https://api.uniswap.org/v1/quote?chainId=${chainId}&tokenInAddress=${fromTokenAddress}&tokenOutAddress=${toTokenAddress}&amount=${amount}`;
      const uniswapResponse = await fetch(uniswapUrl);
      const uniswapData = await uniswapResponse.json();
      if (uniswapResponse.ok && uniswapData.quote) {
        responseData = { toAmount: uniswapData.quote, fromAmount: amount };
        aggregator = 'UniswapAPI';
      }
    } catch (err) {
      console.warn('Uniswap API quote failed:', err.message);
    }
  }

  // 优先级5: Jupiter (仅 Solana)
  if (!responseData && chainId === 501) {
    try {
      const slippageBps = Math.round(Number(slippage) * 100);
      const jupiterUrl = `https://quote-api.jup.ag/v6/quote?inputMint=${fromTokenAddress}&outputMint=${toTokenAddress}&amount=${amount}&slippageBps=${slippageBps}`;
      const jupiterResponse = await fetch(jupiterUrl);
      const jupiterData = await jupiterResponse.json();
      if (jupiterResponse.ok && jupiterData.outAmount) {
        responseData = {
          toAmount: jupiterData.outAmount,
          fromAmount: amount,
          priceImpact: jupiterData.priceImpactPct ? parseFloat(jupiterData.priceImpactPct) * 100 : null,
        };
        aggregator = 'Jupiter';
      }
    } catch (err) {
      console.warn('Jupiter quote failed:', err.message);
    }
  }

  if (responseData) {
    res.status(200).json({
      ...responseData,
      aggregator,
      priceImpact: responseData.priceImpact || null,
    });
  } else {
    res.status(404).json({ error: 'No route found from any aggregator' });
  }
}

export const config = {
  api: {
    externalResolver: true,
  },
};
