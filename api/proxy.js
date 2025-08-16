// api/proxy.js
import fetch from "node-fetch";

export default async function handler(req, res) {
  try {
    const { url } = req.query;
    if (!url) {
      res.status(400).send("Missing URL");
      return;
    }

    const response = await fetch(url);
    if (!response.ok) {
      res.status(response.status).send("Upstream error");
      return;
    }

    // Guess MIME by extension
    let contentType = "application/octet-stream";
    if (url.includes(".mpd")) {
      contentType = "application/dash+xml";
    } else if (url.includes(".m3u8")) {
      contentType = "application/vnd.apple.mpegurl";
    }

    const buf = await response.buffer();
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", contentType);
    res.send(buf);
  } catch (err) {
    res.status(500).send("Proxy error: " + err.message);
  }
}
