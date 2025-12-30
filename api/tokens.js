// /api/tokens.js
// Vercel Serverless Function：多源聚合代币列表，支持所有主流 EVM 链 + Solana + TRON
import { POPULAR_SOLANA_TOKENS } from '../constants/chainTokens';

const SUPPORTED_CHAINS = [
  1, 56, 137, 10, 42161, 8453, 324, 100, 43114, 250,
  1313161554, 8217, 59144, 81457, 7777777, 42220, 534352,
  5000, 169, 34443, 3776, 1301, 480, 728126428, // TRON
];

const COINGECKO_LISTS = {
  1: 'https://tokens.coingecko.com/uniswap/all.json',
  10: 'https://tokens.coingecko.com/optimism/all.json',
  42161: 'https://tokens.coingecko.com/arbitrum-one/all.json',
  8453: 'https://tokens.coingecko.com/base/all.json',
  324: 'https://tokens.coingecko.com/zksync/all.json',
  59144: 'https://tokens.coingecko.com/linea/all.json',
  81457: 'https://tokens.coingecko.com/blast/all.json',
  7777777: 'https://tokens.coingecko.com/zora/all.json',
  534352: 'https://tokens.coingecko.com/scroll/all.json',
};

const FALLBACK_LISTS = {
  56: 'https://tokens.pancakeswap.finance/pancakeswap-extended.json',
  137: 'https://unpkg.com/quickswap-default-token-list@1.1.17/build/quickswap-default.tokenlist.json',
  43114: 'https://raw.githubusercontent.com/traderjoe-xyz/joe-tokenlists/main/joe.tokenlist.json',
  250: 'https://raw.githubusercontent.com/spookyswap/spooky-tokenlist/main/spooky.tokenlist.json',
};

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
  if (!SUPPORTED_CHAINS.includes(numericChainId) && numericChainId !== 501) {
    return res.status(400).json({ error: 'Unsupported chainId' });
  }

  // 设置 CORS 和缓存
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=600');

  let tokens = {};

  try {
    // 优先级1: 1inch 官方 API（最全面、最准确）
    const oneInchUrl = `https://api.1inch.io/v5.2/${numericChainId}/tokens`;
    const oneInchRes = await fetch(oneInchUrl, { next: { revalidate: 3600 } });
    if (oneInchRes.ok) {
      const data = await oneInchRes.json();
      if (data.tokens) {
        return res.status(200).json(data);
      }
    }
    console.warn(`1inch API failed for chain ${numericChainId}`);
  } catch (err) {
    console.warn(`1inch request error for chain ${numericChainId}:`, err.message);
  }

  try {
    // 优先级2: Coingecko 专用列表
    const cgUrl = COINGECKO_LISTS[numericChainId];
    if (cgUrl) {
      const cgRes = await fetch(cgUrl);
      if (cgRes.ok) {
        const cgData = await cgRes.json();
        const tokenArray = cgData.tokens || [];
        tokenArray.forEach(t => {
          if (t.chainId === numericChainId) {
            tokens[t.address.toLowerCase()] = {
              symbol: t.symbol,
              name: t.name,
              address: t.address.toLowerCase(),
              decimals: t.decimals,
              logoURI: t.logoURI || null,
            };
          }
        });
        if (Object.keys(tokens).length > 0) {
          return res.status(200).json({ tokens });
        }
      }
    }
  } catch (err) {
    console.warn(`Coingecko list failed for chain ${numericChainId}:`, err.message);
  }

  try {
    // 优先级3: 其他 DEX 官方列表 fallback
    const fbUrl = FALLBACK_LISTS[numericChainId];
    if (fbUrl) {
      const fbRes = await fetch(fbUrl);
      if (fbRes.ok) {
        const fbData = await fbRes.json();
        const tokenArray = fbData.tokens || fbData;
        tokenArray.forEach(t => {
          if (t.chainId === numericChainId) {
            tokens[t.address.toLowerCase()] = {
              symbol: t.symbol,
              name: t.name,
              address: t.address.toLowerCase(),
              decimals: t.decimals,
              logoURI: t.logoURI || null,
            };
          }
        });
        if (Object.keys(tokens).length > 0) {
          return res.status(200).json({ tokens });
        }
      }
    }
  } catch (err) {
    console.warn(`Fallback list failed for chain ${numericChainId}:`, err.message);
  }

  // 优先级4: Solana 专用（从 constants 导入，统一维护）
  if (numericChainId === 501) {
    POPULAR_SOLANA_TOKENS.forEach(t => {
      tokens[t.mint.toLowerCase()] = {
        symbol: t.symbol,
        name: t.name,
        address: t.mint.toLowerCase(),
        decimals: t.decimals,
        logoURI: t.logoURI,
      };
    });
    return res.status(200).json({ tokens });
  }

  // 最终返回空对象（极少发生）
  console.error(`All token sources failed for chain ${numericChainId}`);
  return res.status(200).json({ tokens: {} });
}

export const config = {
  api: {
    externalResolver: true,
  },
};
