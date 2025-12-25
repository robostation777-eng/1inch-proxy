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

  // 层1: 1inch
  try {
    const params = new URLSearchParams();
    params.append('fromTokenAddress', fromTokenAddress);
    params.append('toTokenAddress', toTokenAddress);
    params.append('amount', amount);
    params.append('fromAddress', fromAddress);
    params.append('slippage', slippage);

    const inchUrl = `https://api.1inch.dev/swap/v6.1/42161/swap?${params.toString()}`;
    const inchResponse = await fetch(inchUrl, {
      headers: {
        Authorization: `Bearer ${process.env.ONEINCH_API_KEY}`,
      },
    });
    const inchData = await inchResponse.json();
    if (inchResponse.ok && inchData.tx) {
      res.status(200).json(inchData);
      return;
    }
  } catch (err) {
    console.warn('1inch swap failed, trying fallback');
  }

  // 层2 & 3: KyberSwap + 0x 需要前端处理两步（quote + build），代理难以统一
  // 因此 swap 代理仅保留 1inch，复杂 fallback 移至前端（更灵活）

  // 仅返回 1inch 失败时错误，前端根据 quote 结果决定使用哪个聚合器
  res.status(404).json({ error: 'No swap route from 1inch, fallback handled in frontend' });
}

export const config = {
  api: {
    externalResolver: true,
  },
};
