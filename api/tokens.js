// api/tokens.js
// Vercel Serverless Function：代理 1inch tokens API，支持跨域

export default async function handler(req, res) {
  // 只允许 GET 请求
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { chainId } = req.query;

  // 必须提供 chainId
  if (!chainId) {
    return res.status(400).json({ error: 'Missing chainId parameter' });
  }

  // 验证 chainId 是数字（防止注入）
  if (!/^\d+$/.test(chainId)) {
    return res.status(400).json({ error: 'Invalid chainId' });
  }

  try {
    // 转发到 1inch 官方 API
    const url = `https://api.1inch.io/v5.2/${chainId}/tokens`;
    const response = await fetch(url);

    if (!response.ok) {
      // 1inch 返回错误时，转发状态码和信息
      const errorData = await response.json().catch(() => ({}));
      return res.status(response.status).json(errorData || { error: '1inch API error' });
    }

    const data = await response.json();

    // 设置 CORS 头，允许前端跨域访问
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // 缓存 5 分钟（减少 1inch API 压力）
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');

    res.status(200).json(data);
  } catch (error) {
    console.error('Proxy tokens error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Vercel 需要这个配置（处理异步 fetch）
export const config = {
  api: {
    externalResolver: true,
  },
};
