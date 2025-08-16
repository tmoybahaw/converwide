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

    let contentType = response.headers.get("content-type") || "";

if (targetUrl.includes(".mpd")) {
  contentType = "application/dash+xml";
} else if (targetUrl.includes(".m3u8")) {
  contentType = "application/vnd.apple.mpegurl";
} else if (!contentType) {
  contentType = "application/octet-stream";
}


    const buffer = await response.arrayBuffer();
    let data = Buffer.from(buffer);

    // ---- DASH MPD Handling ----
    if (
      contentType.includes("xml") ||
      contentType.includes("mpd") ||
      targetUrl.includes(".mpd")
    ) {
      let xml = data.toString("utf8");

      // Rewrite <BaseURL>
      xml = xml.replace(/<BaseURL>(.*?)<\/BaseURL>/g, (match, url) => {
        const absUrl = new URL(url, targetUrl).href;
        const proxied = "/api/proxy?url=" + encodeURIComponent(absUrl);
        return `<BaseURL>${proxied}</BaseURL>`;
      });

      // Rewrite initialization
      xml = xml.replace(/(initialization=")([^"]+)"/g, (m, p1, url) => {
        const absUrl = new URL(url, targetUrl).href;
        const proxied = "/api/proxy?url=" + encodeURIComponent(absUrl);
        return `${p1}${proxied}"`;
      });

      // Rewrite media
      xml = xml.replace(/(media=")([^"]+)"/g, (m, p1, url) => {
        const absUrl = new URL(url, targetUrl).href;
        const proxied = "/api/proxy?url=" + encodeURIComponent(absUrl);
        return `${p1}${proxied}"`;
      });

      data = Buffer.from(xml, "utf8");
      contentType = "application/dash+xml";
    }

    // ---- HLS M3U8 Handling ----
    else if (
      contentType.includes("mpegurl") ||
      contentType.includes("m3u8") ||
      targetUrl.includes(".m3u8")
    ) {
      let m3u8 = data.toString("utf8");

      // Rewrite every non-#EXT line (segment or playlist URLs)
      m3u8 = m3u8.replace(/^(?!#)(.*)$/gm, (line) => {
        if (!line.trim()) return line;
        try {
          const absUrl = new URL(line, targetUrl).href;
          return "/api/proxy?url=" + encodeURIComponent(absUrl);
        } catch {
          return line;
        }
      });

      data = Buffer.from(m3u8, "utf8");
      contentType = "application/vnd.apple.mpegurl";
    }

    // ---- Forward Response ----
    res.setHeader("Content-Type", contentType);
    res.status(response.status).send(data);
  } catch (err) {
    console.error("Proxy error:", err);
    res.status(500).send("Proxy error");
  }
}
