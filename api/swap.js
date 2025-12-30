// src/pages/api/swap.js
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

  try {
    const chainId = parseInt(req.query.chainId || '42161', 10);
    const queryParams = { ...req.query };
    const getParam = (key) => {
      const value = queryParams[key];
      return Array.isArray(value) ? value[0]?.toString().trim() : value?.toString().trim();
    };

    let fromTokenAddress = getParam('fromTokenAddress')?.toLowerCase() || '';
    let toTokenAddress = getParam('toTokenAddress')?.toLowerCase() || '';
    const amount = getParam('amount') || '';
    const fromAddress = getParam('fromAddress') || '';
    const slippage = getParam('slippage') || '0.5';

    if (!fromTokenAddress || !toTokenAddress || !amount || !fromAddress) {
      res.status(400).json({ error: 'Missing required parameters' });
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

    let txData = null;
    let aggregator = 'Unknown';

    const fetchWithTimeout = (url, options = {}, timeout = 8000) => {
      return Promise.race([
        fetch(url, options),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeout))
      ]);
    };

    // 优先并发尝试 KyberSwap 和 OpenOcean
    try {
      const kyberPromise = (async () => {
        const routeUrl = `https://aggregator-api.kyberswap.com/${chainSlug}/api/v1/routes?tokenIn=${fromTokenAddress}&tokenOut=${toTokenAddress}&amountIn=${amount}`;
        const routeRes = await fetchWithTimeout(routeUrl, { headers: { 'x-client-id': 'RBS DApp' } });
        if (!routeRes.ok) return null;
        const routeData = await routeRes.json();
        if (!routeData.data?.routeSummary) return null;

        const buildUrl = `https://aggregator-api.kyberswap.com/${chainSlug}/api/v1/route/build`;
        const slippageBps = Math.round(Number(slippage) * 100);
        const buildRes = await fetchWithTimeout(buildUrl, {
          method: 'POST',
          headers: { 'x-client-id': 'RBS DApp', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            routeSummary: routeData.data.routeSummary,
            sender: fromAddress,
            recipient: fromAddress,
            slippageTolerance: slippageBps,
          }),
        });
        if (!buildRes.ok) return null;
        const buildData = await buildRes.json();
        if (!buildData.data?.data) return null;

        return {
          to: routeData.data.routerAddress || '0x6131b5fae19ea4f9d964eac0408e4408b66337b5',
          data: buildData.data.data,
          value: buildData.data.value || '0',
          aggregator: 'KyberSwap',
        };
      })();

      const openOceanPromise = (async () => {
        const ooSlippage = Math.round(Number(slippage) * 100);
        const ooUrl = `https://open-api.openocean.finance/v3/${chainSlug}/swap?inTokenAddress=${fromTokenAddress}&outTokenAddress=${toTokenAddress}&amount=${amount}&slippage=${ooSlippage}&account=${fromAddress}&gasPrice=5`;
        const ooRes = await fetchWithTimeout(ooUrl);
        if (!ooRes.ok) return null;
        const ooData = await ooRes.json();
        if (!ooData.data?.data) return null;

        return {
          to: ooData.data.to,
          data: ooData.data.data,
          value: ooData.data.value || '0',
          aggregator: 'OpenOcean',
        };
      })();

      const [kyberResult, ooResult] = await Promise.allSettled([kyberPromise, openOceanPromise]);

      if (kyberResult.status === 'fulfilled' && kyberResult.value) {
        txData = { to: kyberResult.value.to, data: kyberResult.value.data, value: kyberResult.value.value };
        aggregator = kyberResult.value.aggregator;
      } else if (ooResult.status === 'fulfilled' && ooResult.value) {
        txData = { to: ooResult.value.to, data: ooResult.value.data, value: ooResult.value.value };
        aggregator = ooResult.value.aggregator;
      }
    } catch (err) {
      console.warn('Primary aggregators failed:', err.message);
    }

    // Fallback: 1inch
    if (!txData) {
      try {
        const params = new URLSearchParams({
          fromTokenAddress, toTokenAddress, amount, fromAddress, slippage,
        });
        const inchUrl = `https://api.1inch.dev/swap/v6.1/${chainId}/swap?${params.toString()}`;
        const inchRes = await fetchWithTimeout(inchUrl, {
          headers: { Authorization: `Bearer ${process.env.ONEINCH_API_KEY}`, Accept: 'application/json' }
        });
        if (inchRes.ok) {
          const inchData = await inchRes.json();
          if (inchData.tx) {
            txData = inchData.tx;
            aggregator = '1inch';
          }
        }
      } catch (err) {
        console.warn('1inch fallback failed:', err.message);
      }
    }

    // Fallback: Uniswap API (可选，视支持情况)
    // if (!txData) { ... }

    // Solana: Jupiter
    if (!txData && chainId === 501) {
      try {
        const slippageBps = Math.round(Number(slippage) * 100);
        const quoteUrl = `https://quote-api.jup.ag/v6/quote?inputMint=${fromTokenAddress}&outputMint=${toTokenAddress}&amount=${amount}&slippageBps=${slippageBps}`;
        const quoteRes = await fetchWithTimeout(quoteUrl);
        if (!quoteRes.ok) throw new Error('Quote failed');
        const quoteData = await quoteRes.json();

        const swapUrl = 'https://quote-api.jup.ag/v6/swap';
        const swapRes = await fetchWithTimeout(swapUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            quoteResponse: quoteData,
            userPublicKey: fromAddress,
            wrapAndUnwrapSol: true,
          }),
        });
        if (!swapRes.ok) throw new Error('Swap build failed');
        const swapData = await swapRes.json();

        if (swapData.swapTransaction) {
          txData = {
            data: swapData.swapTransaction,
            to: null,
            value: '0',
          };
          aggregator = 'Jupiter';
        }
      } catch (err) {
        console.warn('Jupiter swap failed:', err.message);
      }
    }

    if (txData) {
      res.status(200).json({
        tx: txData,
        aggregator,
        jupiterSpecific: aggregator === 'Jupiter',
      });
    } else {
      res.status(404).json({ error: 'No swap route from any aggregator' });
    }
  } catch (globalErr) {
    console.error('Unexpected error in swap handler:', globalErr);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export const config = {
  api: {
    externalResolver: true,
  },
};
