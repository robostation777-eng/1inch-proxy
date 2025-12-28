// /api/tokens.js
// Vercel Serverless Function：多源聚合代币列表，支持所有主流 EVM 链
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  const { chainId } = req.query;
  if (!chainId || !/^\d+$/.test(chainId)) {
    return res.status(400).json({ error: 'Invalid or missing chainId parameter' });
  }
  const numericChainId = parseInt(chainId, 10);
  // 设置 CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');
  try {
    // 层1: 优先使用 1inch 官方 API（覆盖最全、最准确）
    const oneInchUrl = `https://api.1inch.io/v5.2/${numericChainId}/tokens`;
    const oneInchResponse = await fetch(oneInchUrl, { next: { revalidate: 300 } });
    if (oneInchResponse.ok) {
      const data = await oneInchResponse.json();
      return res.status(200).json(data);
    }
    console.warn(`1inch API failed for chain ${numericChainId}, status: ${oneInchResponse.status}`);
  } catch (err) {
    console.warn(`1inch API request failed for chain ${numericChainId}:`, err.message);
  }
  // 层2: Fallback 到 Coingecko 或其他公共列表（根据 chainId 映射知名列表）
  try {
    const fallbackLists = {
      // Ethereum & L2s
      1: 'https://tokens.coingecko.com/uniswap/all.json',
      10: 'https://tokens.coingecko.com/optimism/all.json',
      42161: 'https://tokens.coingecko.com/arbitrum-one/all.json',
      8453: 'https://tokens.coingecko.com/base/all.json',
      324: 'https://tokens.coingecko.com/zksync/all.json',
      59144: 'https://tokens.coingecko.com/linea/all.json',
      81457: 'https://tokens.coingecko.com/blast/all.json',
      7777777: 'https://tokens.coingecko.com/zora/all.json',
      534352: 'https://tokens.coingecko.com/scroll/all.json',
      // BSC & Polygon
      56: 'https://tokens.pancakeswap.finance/pancakeswap-extended.json',
      137: 'https://unpkg.com/quickswap-default-token-list@1.1.17/build/quickswap-default.tokenlist.json',
      // Avalanche
      43114: 'https://raw.githubusercontent.com/traderjoe-xyz/joe-tokenlists/main/joe.tokenlist.json',
      // Fantom
      250: 'https://raw.githubusercontent.com/spookyswap/spooky-tokenlist/main/spooky.tokenlist.json',
      // 新增 Gnosis Chain fallback（Honeyswap 官方 tokenlist）
      100: 'https://raw.githubusercontent.com/honeyswap/default-token-list/master/src/tokens/gnosis-chain/mainnet.json',
    };
    const fallbackUrl = fallbackLists[numericChainId];
    if (fallbackUrl) {
      const fallbackResponse = await fetch(fallbackUrl);
      if (fallbackResponse.ok) {
        const listData = await fallbackResponse.json();
        // 转换为 1inch 兼容格式
        const tokens = {};
        const tokenArray = listData.tokens || listData;
        tokenArray.forEach(token => {
          if (token.chainId === numericChainId) {
            tokens[token.address.toLowerCase()] = {
              symbol: token.symbol,
              name: token.name,
              address: token.address.toLowerCase(),
              decimals: token.decimals,
              logoURI: token.logoURI || null,
            };
          }
        });
        return res.status(200).json({ tokens });
      }
    }
  } catch (err) {
    console.warn(`Fallback token list failed for chain ${numericChainId}:`, err.message);
  }
  // 最终 fallback：返回空列表（极少发生）
  console.error(`All token sources failed for chain ${numericChainId}`);
  return res.status(200).json({ tokens: {} });
}
export const config = {
  api: {
    externalResolver: true,
  },
};
