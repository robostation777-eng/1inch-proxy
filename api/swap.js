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

    const fromTokenAddress = getParam('fromTokenAddress')?.toLowerCase() || '';
    const toTokenAddress = getParam('toTokenAddress')?.toLowerCase() || '';
    const amount = getParam('amount') || '';
    const fromAddress = getParam('fromAddress') || '';
    const slippage = getParam('slippage') || '0.5';

    if (!fromTokenAddress || !toTokenAddress || !amount || !fromAddress) {
      res.status(400).json({ error: 'Missing required parameters' });
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

    let txData = null;
    let aggregator = 'Unknown';

    // 优先级1: KyberSwap
    try {
      let tokenIn = fromTokenAddress === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' ? '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' : fromTokenAddress;
      let tokenOut = toTokenAddress === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' ? '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' : toTokenAddress;
      const routeUrl = `https://aggregator-api.kyberswap.com/${chainSlug}/api/v1/routes?tokenIn=${tokenIn}&tokenOut=${tokenOut}&amountIn=${amount}`;
      const routeResponse = await fetch(routeUrl, { headers: { 'x-client-id': 'RBS DApp' } });
      const routeData = await routeResponse.json();
      if (routeResponse.ok && routeData.data?.routeSummary) {
        const buildUrl = `https://aggregator-api.kyberswap.com/${chainSlug}/api/v1/route/build`;
        const kyberSlippageBps = Math.round(Number(slippage) * 100);
        const body = {
          routeSummary: routeData.data.routeSummary,
          sender: fromAddress,
          recipient: fromAddress,
          slippageTolerance: kyberSlippageBps,
        };
        const buildResponse = await fetch(buildUrl, {
          method: 'POST',
          headers: { 'x-client-id': 'RBS DApp', 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const buildData = await buildResponse.json();
        if (buildResponse.ok && buildData.data?.data) {
          txData = {
            to: routeData.data.routerAddress || '0x6131b5fae19ea4f9d964eac0408e4408b66337b5',
            data: buildData.data.data,
            value: buildData.data.value || '0',
          };
          aggregator = 'KyberSwap';
        }
      }
    } catch (err) {
      console.warn('KyberSwap swap failed:', err.message);
    }

    // 优先级2: OpenOcean
    if (!txData) {
      try {
        const openOceanUrl = `https://open-api.openocean.finance/v3/${chainSlug}/swap?inTokenAddress=${fromTokenAddress}&outTokenAddress=${toTokenAddress}&amount=${amount}&slippage=${Math.round(Number(slippage) * 100)}&account=${fromAddress}&gasPrice=5`;
        const openOceanResponse = await fetch(openOceanUrl);
        const openOceanData = await openOceanResponse.json();
        if (openOceanResponse.ok && openOceanData.data?.data) {
          txData = {
            to: openOceanData.data.to,
            data: openOceanData.data.data,
            value: openOceanData.data.value || '0',
          };
          aggregator = 'OpenOcean';
        }
      } catch (err) {
        console.warn('OpenOcean swap failed:', err.message);
      }
    }

    // 优先级3: 1inch
    if (!txData) {
      try {
        const params = new URLSearchParams({
          fromTokenAddress, toTokenAddress, amount, fromAddress, slippage,
        });
        const inchUrl = `https://api.1inch.dev/swap/v6.1/${chainId}/swap?${params.toString()}`;
        const inchResponse = await fetch(inchUrl, {
          headers: { Authorization: `Bearer ${process.env.ONEINCH_API_KEY}`, Accept: 'application/json' },
        });
        const inchData = await inchResponse.json();
        if (inchResponse.ok && inchData.tx) {
          txData = inchData.tx;
          aggregator = '1inch';
        }
      } catch (err) {
        console.warn('1inch swap failed:', err.message);
      }
    }

    // 优先级4: Uniswap API
    if (!txData) {
      try {
        const uniswapUrl = `https://api.uniswap.org/v1/swap?chainId=${chainId}&tokenInAddress=${fromTokenAddress}&tokenOutAddress=${toTokenAddress}&amount=${amount}&recipient=${fromAddress}&slippageTolerance=${slippage}`;
        const uniswapResponse = await fetch(uniswapUrl);
        const uniswapData = await uniswapResponse.json();
        if (uniswapResponse.ok && uniswapData.tx) {
          txData = uniswapData.tx;
          aggregator = 'UniswapAPI';
        }
      } catch (err) {
        console.warn('Uniswap API swap failed:', err.message);
      }
    }

    // 优先级5: Jupiter (仅 Solana)
    if (!txData && chainId === 501) {
      try {
        const slippageBps = Math.round(Number(slippage) * 100);
        const quoteUrl = `https://quote-api.jup.ag/v6/quote?inputMint=${fromTokenAddress}&outputMint=${toTokenAddress}&amount=${amount}&slippageBps=${slippageBps}`;
        const quoteResponse = await fetch(quoteUrl);
        const quoteData = await quoteResponse.json();
        if (quoteResponse.ok && quoteData.outAmount) {
          const swapUrl = 'https://quote-api.jup.ag/v6/swap';
          const swapBody = {
            quoteResponse: quoteData,
            userPublicKey: fromAddress,
            wrapAndUnwrapSol: true,
          };
          const swapResponse = await fetch(swapUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(swapBody),
          });
          const swapData = await swapResponse.json();
          if (swapResponse.ok && swapData.swapTransaction) {
            txData = {
              data: swapData.swapTransaction,
              to: null,
              value: '0',
            };
            aggregator = 'Jupiter';
          }
        }
      } catch (err) {
        console.warn('Jupiter swap failed:', err.message);
      }
    }

    if (txData) {
      res.status(200).json({ tx: txData, aggregator, jupiterSpecific: aggregator === 'Jupiter' });
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
