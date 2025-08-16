export default async function handler(req, res) {
  const target = req.query.url;

  if (!target) {
    return res.status(400).send("❌ Missing ?url parameter");
  }

  // Only allow http(s)
  if (!/^https?:\/\//i.test(target)) {
    return res.status(400).send("❌ Invalid URL");
  }

  try {
    const response = await fetch(target, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
      }
    });

    if (!response.ok) {
      return res.status(response.status).send(`❌ Fetch failed: ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type") || "application/octet-stream";
    const body = await response.text();

    // ✅ Fix CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Content-Type", contentType);

    res.status(200).send(body);

  } catch (err) {
    console.error("Proxy error:", err);
    res.status(500).send("❌ Proxy error: " + err.message);
  }
}
