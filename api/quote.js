export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).end();
    return;
  }

  const fromTokenAddress = (Array.isArray(req.query.fromTokenAddress)
    ? req.query.fromTokenAddress[0]
    : req.query.fromTokenAddress || '').toString().toLowerCase().trim();

  const toTokenAddress = (Array.isArray(req.query.toTokenAddress)
    ? req.query.toTokenAddress[0]
    : req.query.toTokenAddress || '').toString().toLowerCase().trim();

  const amount = (Array.isArray(req.query.amount)
    ? req.query.amount[0]
    : req.query.amount || '').toString().trim();

  if (!fromTokenAddress || !toTokenAddress || !amount) {
    res.status(400).json({ error: 'Missing parameters' });
    return;
  }

  // 2025 年 12 月最新官方 endpoint：加 /swap 和 v6.1
  const url = `https://api.1inch.dev/swap/v6.1/42161/quote?fromTokenAddress=${fromTokenAddress}&toTokenAddress=${toTokenAddress}&amount=${amount}`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${process.env.ONEINCH_API_KEY}`,
      },
    });

    const data = await response.json();

    res.status(response.status).json(data);
  } catch (error) {
    console.error('1inch proxy error:', error);
    res.status(500).json({ error: 'Proxy error' });
  }
}

export const config = {
  api: {
    externalResolver: true,
  },
};
