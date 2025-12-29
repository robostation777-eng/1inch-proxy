// src/pages/api/swap.js (或您的实际路径)
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
  try {
    const chainId = parseInt(req.query.chainId || '42161', 10);
    const queryParams = { ...req.query };
    const getParam = (key) => {
      const value = queryParams[key];
      if (Array.isArray(value)) return value[0]?.toString().trim() || '';
      return value?.toString().trim() || '';
    };
    const fromTokenAddress = getParam('fromTokenAddress').toLowerCase();
    const toTokenAddress = getParam('toTokenAddress').toLowerCase();
    const amount = getParam('amount');
    const fromAddress = getParam('fromAddress');
    const slippage = getParam('slippage') || '0.5';
    if (!fromTokenAddress || !toTokenAddress || !amount || !fromAddress) {
      res.status(400).json({ error: 'Missing required parameters' });
      return;
    }
    // 链 slug 映射
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
    let txData = null;

    // 层1: 1inch swap
    try {
      const params = new URLSearchParams();
      params.append('fromTokenAddress', fromTokenAddress);
      params.append('toTokenAddress', toTokenAddress);
      params.append('amount', amount);
      params.append('fromAddress', fromAddress);
      params.append('slippage', slippage);
      const inchUrl = `https://api.1inch.dev/swap/v6.1/${chainId}/swap?${params.toString()}`;
      const inchResponse = await fetch(inchUrl, {
        headers: {
          Authorization: `Bearer ${process.env.ONEINCH_API_KEY}`,
          Accept: 'application/json',
        },
      });
      const inchData = await inchResponse.json();
      if (inchResponse.ok && inchData.tx) {
        txData = inchData.tx;
        res.status(200).json({ ...inchData, aggregator: '1inch' });
        return;
      }
    } catch (err) {
      console.warn('1inch swap failed:', err.message);
    }

    // 层2: KyberSwap swap
    if (!txData) {
      try {
        let tokenIn = fromTokenAddress;
        let tokenOut = toTokenAddress;
        if (tokenIn === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') tokenIn = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
        if (tokenOut === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') tokenOut = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
        const routeUrl = `https://aggregator-api.kyberswap.com/${chainSlug}/api/v1/routes?tokenIn=${tokenIn}&tokenOut=${tokenOut}&amountIn=${amount}`;
        const routeResponse = await fetch(routeUrl, { headers: { 'x-client-id': 'RBS DApp' } });
        const routeData = await routeResponse.json();
        if (routeResponse.ok && routeData.data?.routeSummary) {
          const buildUrl = `https://aggregator-api.kyberswap.com/${chainSlug}/api/v1/route/build`;
          const isReverse = fromTokenAddress.toLowerCase() === '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9';
          const kyberSlippageBps = isReverse ? Math.max(Math.round(Number(slippage) * 100), 500) : Math.round(Number(slippage) * 100);
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
            res.status(200).json({ tx: txData, aggregator: 'KyberSwap' });
            return;
          }
        }
      } catch (err) {
        console.warn('KyberSwap swap failed:', err.message);
      }
    }

    // 层3: OpenOcean swap
    if (!txData) {
      try {
        const openOceanUrl = `https://open-api.openocean.finance/v3/${chainSlug}/swap?inTokenAddress=${fromTokenAddress}&outTokenAddress=${toTokenAddress}&amount=${amount}&slippage=${Math.round(Number(slippage) * 100)}&account=${fromAddress}&gasPrice=5`;
        const openOceanResponse = await fetch(openOceanUrl);
        const openOceanData = await openOceanResponse.json();
        if (openOceanResponse.ok && openOceanData.data && openOceanData.data.data) {
          txData = {
            to: openOceanData.data.to,
            data: openOceanData.data.data,
            value: openOceanData.data.value || '0',
          };
          res.status(200).json({ tx: txData, aggregator: 'OpenOcean' });
          return;
        }
      } catch (err) {
        console.warn('OpenOcean swap failed:', err.message);
      }
    }

    // 层4: Uniswap API swap
    if (!txData) {
      try {
        const uniswapUrl = `https://api.uniswap.org/v1/swap?chainId=${chainId}&tokenInAddress=${fromTokenAddress}&tokenOutAddress=${toTokenAddress}&amount=${amount}&recipient=${fromAddress}&slippageTolerance=${slippage}`;
        const uniswapResponse = await fetch(uniswapUrl);
        const uniswapData = await uniswapResponse.json();
        if (uniswapResponse.ok && uniswapData.tx) {
          txData = uniswapData.tx;
          res.status(200).json({ tx: txData, aggregator: 'UniswapAPI' });
          return;
        }
      } catch (err) {
        console.warn('Uniswap API swap failed:', err.message);
      }
    }

    // 层5: Jupiter Swap API (专为 Solana 链添加，使用环境变量中的 API Key)
    if (!txData && chainId === 501) {
      try {
        // 修正：使用官方 Quote 端点 /quote
        const slippageBps = Math.round(Number(slippage) * 100);
        const quoteUrl = `https://api.jup.ag/quote?inputMint=${fromTokenAddress}&outputMint=${toTokenAddress}&amount=${amount}&slippageBps=${slippageBps}`;
        const quoteResponse = await fetch(quoteUrl, {
          headers: {
            'x-api-key': process.env.JUPITER_API_KEY,
          },
        });
        if (!quoteResponse.ok) {
          const errorText = await quoteResponse.text();
          console.warn(`Jupiter quote failed with status ${quoteResponse.status}: ${errorText}`);
        } else {
          const quoteData = await quoteResponse.json();
          if (quoteData.outAmount) {
            // 修正：使用官方 Swap 端点 /swap (POST)
            const swapUrl = 'https://api.jup.ag/swap';
            const swapBody = {
              quoteResponse: quoteData,
              userPublicKey: fromAddress,
              wrapAndUnwrapSol: true,
            };
            const swapResponse = await fetch(swapUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.JUPITER_API_KEY,
              },
              body: JSON.stringify(swapBody),
            });
            if (!swapResponse.ok) {
              const errorText = await swapResponse.text();
              console.warn(`Jupiter swap failed with status ${swapResponse.status}: ${errorText}`);
            } else {
              const swapData = await swapResponse.json();
              if (swapData.swapTransaction) {
                res.status(200).json({
                  tx: {
                    data: swapData.swapTransaction, // base64 字符串
                    to: null,
                    value: '0',
                  },
                  aggregator: 'Jupiter',
                  jupiterSpecific: true,
                });
                return;
              }
            }
          } else {
            console.warn('Jupiter quote returned no outAmount:', quoteData);
          }
        }
      } catch (err) {
        console.warn('Jupiter swap exception:', err.message);
      }
    }

    // 所有聚合器失败
    res.status(404).json({ error: 'No swap route from any aggregator' });
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
