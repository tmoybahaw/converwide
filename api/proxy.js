// api/proxy.js
export default async function handler(req, res) {
  try {
    const { url } = req.query;
    if (!url) {
      res.status(400).send("Missing URL");
      return;
    }

    const upstream = await fetch(url);
    if (!upstream.ok) {
      res.status(upstream.status).send("Upstream error");
      return;
    }

    // Detect MIME
    let contentType = "application/octet-stream";
    if (url.includes(".mpd")) {
      contentType = "application/dash+xml";
    } else if (url.includes(".m3u8")) {
      contentType = "application/vnd.apple.mpegurl";
    }

    const arrayBuf = await upstream.arrayBuffer();
    const buf = Buffer.from(arrayBuf);

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", contentType);
    res.send(buf);
  } catch (err) {
    res.status(500).send("Proxy error: " + err.message);
  }
}
