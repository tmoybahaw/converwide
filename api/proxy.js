const express = require('express');
const fetch = require('node-fetch'); // Use global fetch if on Node 18+
const app = express();
const PORT = process.env.PORT || 3000;

// Allow CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Token');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Generic proxy for media and license requests
app.all('/proxy', async (req, res) => {
  const target = req.query.target;
  if (!target) return res.status(400).send('Missing target URL');

  try {
    // Collect headers from the incoming request to forward to the target
    const forwardHeaders = {
      ...req.headers,
      'host': new URL(target).host // Set host header to the target host
    };

    // Remove headers that should not be forwarded
    delete forwardHeaders.cookie;
    delete forwardHeaders['content-length']; // This will be set automatically by fetch
    
    // Create a new request body from the incoming request
    const body = req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined;

    const upstream = await fetch(target, {
      method: req.method,
      headers: forwardHeaders,
      body: body,
      redirect: 'follow'
    });

    // Forward the status and headers from the upstream response
    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      if (key.toLowerCase() !== 'content-length') {
        res.setHeader(key, value);
      }
    });

    // Pipe the response body
    upstream.body.pipe(res);
  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).send('Proxy error: ' + err.message);
  }
});

app.listen(PORT, () => {
  console.log(`Proxy running on port ${PORT}`);
});
