// src/pages/api/quote.js (或您的 handler 文件)
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
  let fromTokenAddress = (req.query.fromTokenAddress || '').toString().trim().toLowerCase();
  let toTokenAddress = (req.query.toTokenAddress || '').toString().trim().toLowerCase();
  const amount = (req.query.amount || '').toString().trim();
  const slippage = (req.query.slippage || '0.5').toString().trim();

  if (!fromTokenAddress || !toTokenAddress || !amount) {
    res.status(400).json({ error: 'Missing parameters' });
    return;
  }

  // 统一处理 native 地址
  if (fromTokenAddress === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
    fromTokenAddress = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
  }
  if (toTokenAddress === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
    toTokenAddress = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
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

  const fetchWithTimeout = (url, options = {}, timeout = 8000) => {
    return Promise.race([
      fetch(url, options),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeout))
    ]);
  };

  // 优先并发尝试 KyberSwap 和 OpenOcean（更快、更准）
  try {
    const [kyberPromise, openOceanPromise] = await Promise.allSettled([
      fetchWithTimeout(`https://aggregator-api.kyberswap.com/${chainSlug}/api/v1/routes?tokenIn=${fromTokenAddress}&tokenOut=${toTokenAddress}&amountIn=${amount}`, {
        headers: { 'x-client-id': 'RBS DApp' }
      }),
      fetchWithTimeout(`https://open-api.openocean.finance/v3/${chainSlug}/quote?inTokenAddress=${fromTokenAddress}&outTokenAddress=${toTokenAddress}&amount=${amount}&gasPrice=5&slippage=100`)
    ]);

    // KyberSwap 优先（priceImpact 更准）
    if (kyberPromise.status === 'fulfilled') {
      const kyberRes = kyberPromise.value;
      if (kyberRes.ok) {
        const kyberData = await kyberRes.json();
        if (kyberData.data?.routeSummary?.amountOut) {
          responseData = {
            toAmount: kyberData.data.routeSummary.amountOut,
            priceImpact: kyberData.data.routeSummary.priceImpact ? parseFloat(kyberData.data.routeSummary.priceImpact) : null,
          };
          aggregator = 'KyberSwap';
        }
      }
    }

    // OpenOcean 次选
    if (!responseData && openOceanPromise.status === 'fulfilled') {
      const openOceanRes = openOceanPromise.value;
      if (openOceanRes.ok) {
        const openOceanData = await openOceanRes.json();
        if (openOceanData.data?.outAmount) {
          responseData = {
            toAmount: openOceanData.data.outAmount,
            priceImpact: openOceanData.data.price_impact ? parseFloat(openOceanData.data.price_impact) : null,
          };
          aggregator = 'OpenOcean';
        }
      }
    }
  } catch (err) {
    console.warn('Primary aggregators failed:', err.message);
  }

  // Fallback 链
  if (!responseData) {
    try {
      const inchUrl = `https://api.1inch.dev/swap/v6.1/${chainId}/quote?fromTokenAddress=${fromTokenAddress}&toTokenAddress=${toTokenAddress}&amount=${amount}`;
      const inchRes = await fetchWithTimeout(inchUrl, {
        headers: { Authorization: `Bearer ${process.env.ONEINCH_API_KEY}`, Accept: 'application/json' }
      });
      if (inchRes.ok) {
        const inchData = await inchRes.json();
        if (inchData.toAmount) {
          responseData = { toAmount: inchData.toAmount };
          aggregator = '1inch';
        }
      }
    } catch (err) {
      console.warn('1inch fallback failed:', err.message);
    }
  }

  // Solana 特殊处理
  if (!responseData && chainId === 501) {
    try {
      const slippageBps = Math.round(Number(slippage) * 100);
      const jupiterUrl = `https://quote-api.jup.ag/v6/quote?inputMint=${fromTokenAddress}&outputMint=${toTokenAddress}&amount=${amount}&slippageBps=${slippageBps}`;
      const jupiterRes = await fetchWithTimeout(jupiterUrl);
      if (jupiterRes.ok) {
        const jupiterData = await jupiterRes.json();
        if (jupiterData.outAmount) {
          responseData = {
            toAmount: jupiterData.outAmount,
            priceImpact: jupiterData.priceImpactPct ? parseFloat(jupiterData.priceImpactPct) * 100 : null,
          };
          aggregator = 'Jupiter';
        }
      }
    } catch (err) {
      console.warn('Jupiter failed:', err.message);
    }
  }

  if (responseData) {
    res.status(200).json({
      toAmount: responseData.toAmount,
      fromAmount: amount,
      priceImpact: responseData.priceImpact || null,
      aggregator,
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
