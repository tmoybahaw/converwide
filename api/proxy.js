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

    // Take content-type from upstream if provided
    let contentType = upstream.headers.get("content-type");

    // If missing or generic, detect by file extension
    if (!contentType || contentType.includes("text/plain")) {
      if (url.includes(".mpd")) {
        contentType = "application/dash+xml";
      } else if (url.includes(".m3u8")) {
        contentType = "application/vnd.apple.mpegurl";
      } else {
        contentType = "application/octet-stream";
      }
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
