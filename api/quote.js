export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).end();
    return;
  }

  // 更宽松地取出参数，支持 Vercel 有时把 query 变成 array 的情况
  // 同时强制地址转小写（1inch API 要求地址必须小写，否则可能被拒绝或报错）
  const fromTokenAddress = (Array.isArray(req.query.fromTokenAddress)
    ? req.query.fromTokenAddress[0]
    : req.query.fromTokenAddress || '').toString().toLowerCase().trim();

  const toTokenAddress = (Array.isArray(req.query.toTokenAddress)
    ? req.query.toTokenAddress[0]
    : req.query.toTokenAddress || '').toString().toLowerCase().trim();

  const amount = (Array.isArray(req.query.amount)
    ? req.query.amount[0]
    : req.query.amount || '').toString().trim();

  // 校验参数（去掉空字符串的情况）
  if (!fromTokenAddress || !toTokenAddress || !amount) {
    res.status(400).json({ error: 'Missing parameters' });
    return;
  }

  // 最新官方 endpoint（2025 年 12 月）：加 /classic/ 路径
  const url = `https://api.1inch.io/v6.0/42161/classic/quote?fromTokenAddress=${fromTokenAddress}&toTokenAddress=${toTokenAddress}&amount=${amount}`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${process.env.ONEINCH_API_KEY}`,
      },
    });

    const data = await response.json();

    // 直接透传 1inch 的状态码和数据（包括无路由时的错误）
    res.status(response.status).json(data);
  } catch (error) {
    console.error('1inch proxy error:', error); // Vercel logs 会记录，便于你以后查
    res.status(500).json({ error: 'Proxy error' });
  }
}

export const config = {
  api: {
    externalResolver: true,
  },
};
