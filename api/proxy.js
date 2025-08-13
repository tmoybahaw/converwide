import fetch from 'node-fetch';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const target = req.query.target;
  if (!target) {
    return res.status(400).send('Missing target URL');
  }

  try {
    const forwardHeaders = {
      ...req.headers,
      host: new URL(target).host,
      'user-agent':
        req.headers['user-agent'] ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
    };

    delete forwardHeaders.cookie;
    delete forwardHeaders['content-length'];

    const upstream = await fetch(target, {
      method: req.method,
      headers: forwardHeaders,
      body:
        req.method !== 'GET' && req.method !== 'HEAD'
          ? req.body
          : undefined,
      redirect: 'follow',
    });

    res.status(upstream.status);

    upstream.headers.forEach((value, key) => {
      if (key.toLowerCase() !== 'content-length') {
        res.setHeader(key, value);
      }
    });

    const buffer = await upstream.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).send('Proxy error: ' + err.message);
  }
}
