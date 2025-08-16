// api/proxy.js
import fetch from "node-fetch";

export default async function handler(req, res) {
  try {
    const targetUrl = req.query.url;
    if (!targetUrl) {
      return res.status(400).send("Missing url parameter");
    }

    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "Origin": req.headers["origin"] || "http://localhost",
        "Referer": req.headers["referer"] || "http://localhost/",
      },
    });

    // Get content-type
    let contentType = response.headers.get("content-type") || "";

    // Handle DASH MPD
    if (targetUrl.includes(".mpd") || contentType.includes("xml")) {
      let xml = await response.text();

      xml = xml.replace(/<BaseURL>(.*?)<\/BaseURL>/g, (match, url) => {
        const absUrl = new URL(url, targetUrl).href;
        return `<BaseURL>/api/proxy?url=${encodeURIComponent(absUrl)}</BaseURL>`;
      });

      xml = xml.replace(/(initialization=")([^"]+)"/g, (m, p1, url) => {
        const absUrl = new URL(url, targetUrl).href;
        return `${p1}/api/proxy?url=${encodeURIComponent(absUrl)}"`;
      });

      xml = xml.replace(/(media=")([^"]+)"/g, (m, p1, url) => {
        const absUrl = new URL(url, targetUrl).href;
        return `${p1}/api/proxy?url=${encodeURIComponent(absUrl)}"`;
      });

      res.setHeader("Content-Type", "application/dash+xml");
      return res.status(200).send(xml);
    }

    // Handle HLS M3U8
    if (targetUrl.includes(".m3u8") || contentType.includes("mpegurl")) {
      let m3u8 = await response.text();

      m3u8 = m3u8.replace(/^(?!#)(.*)$/gm, (line) => {
        if (!line.trim()) return line;
        try {
          const absUrl = new URL(line, targetUrl).href;
          return "/api/proxy?url=" + encodeURIComponent(absUrl);
        } catch {
          return line;
        }
      });

      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      return res.status(200).send(m3u8);
    }

    // Otherwise → stream directly (video segments, init files, etc.)
    res.setHeader("Content-Type", contentType || "application/octet-stream");
    res.status(response.status);

    // Stream the body
    if (response.body) {
      response.body.pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    console.error("Proxy error:", err);
    res.status(500).send("Proxy error");
  }
}
