export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).end();
    return;
  }

  const query = req.query;

  const url = new URL('https://api.1inch.dev/v6.0/42161/swap');
  Object.keys(query).forEach(key => url.searchParams.append(key, query[key]));

  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${process.env.ONEINCH_API_KEY}`,
      },
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Proxy error' });
  }
}

export const config = {
  api: {
    externalResolver: true,
  },
};
