// api/proxy.js
import fetch from "node-fetch";

/**
 * Helper: resolve a possibly-relative `child` URL against a `parent` URL.
 */
function resolveUrl(child, parent) {
  try {
    return new URL(child, parent).href;
  } catch {
    return child; // if it's already absolute or malformed, pass through
  }
}

/**
 * Rewrites MPD XML:
 *  - <BaseURL>...</BaseURL>
 *  - SegmentTemplate initialization="..." media="..."
 */
function rewriteMpd(xml, targetUrl) {
  // Rewrite <BaseURL>
  xml = xml.replace(/<BaseURL>([\s\S]*?)<\/BaseURL>/g, (match, url) => {
    const abs = resolveUrl(url.trim(), targetUrl);
    const proxied = "/api/proxy?url=" + encodeURIComponent(abs);
    return `<BaseURL>${proxied}</BaseURL>`;
  });

  // Rewrite initialization="..."
  xml = xml.replace(/(initialization=")([^"]+)"/g, (m, p1, url) => {
    const abs = resolveUrl(url, targetUrl);
    const proxied = "/api/proxy?url=" + encodeURIComponent(abs);
    return `${p1}${proxied}"`;
  });

  // Rewrite media="..."
  xml = xml.replace(/(media=")([^"]+)"/g, (m, p1, url) => {
    const abs = resolveUrl(url, targetUrl);
    const proxied = "/api/proxy?url=" + encodeURIComponent(abs);
    return `${p1}${proxied}"`;
  });

  return xml;
}

/**
 * Rewrites HLS playlists (Master or Media):
 *  - Bare URIs on their own line (variants or segments)
 *  - EXT-X-KEY:URI="..."
 *  - EXT-X-MAP:URI="..."
 *  - EXT-X-I-FRAME-STREAM-INF:URI="..."
 *  - EXT-X-SESSION-KEY:URI="..."
 *  - EXT-X-SESSION-DATA:URI="..." (rare)
 */
function rewriteM3U8(text, targetUrl) {
  const lines = text.split(/\r?\n/).map((line) => {
    // Master playlist variant lines or media playlist segment lines:
    // If the line isn't a tag (doesn't start with #) and isn't blank,
    // it's a URI. Make it absolute + proxied.
    if (line && !line.startsWith("#")) {
      const abs = resolveUrl(line.trim(), targetUrl);
      return "/api/proxy?url=" + encodeURIComponent(abs);
    }

    // EXT-X-KEY, EXT-X-MAP, EXT-X-I-FRAME-STREAM-INF, EXT-X-SESSION-KEY/ DATA
    const attrUriRegex =
      /(URI=")([^"]+)(")/gi;

    if (/#EXT-X-(KEY|MAP|I-FRAME-STREAM-INF|SESSION-KEY|SESSION-DATA):/i.test(line)) {
      return line.replace(attrUriRegex, (m, p1, url, p3) => {
        const abs = resolveUrl(url, targetUrl);
        const proxied = "/api/proxy?url=" + encodeURIComponent(abs);
        return `${p1}${proxied}${p3}`;
      });
    }

    return line;
  });

  return lines.join("\n");
}

/**
 * Copy selected headers from upstream to response.
 */
function forwardHeaders(upstream, res, overrides = {}) {
  const hopByHop = new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
  ]);

  upstream.headers.forEach((value, key) => {
    if (!hopByHop.has(key.toLowerCase())) {
      // Avoid sending multiple Content-Length when we rewrite content
      if (key.toLowerCase() === "content-length" && overrides["Content-Length"] === undefined) {
        // We'll let Node set correct length when sending Buffer.
        return;
      }
      res.setHeader(key, value);
    }
  });

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Range,User-Agent,Accept,Origin,Referer");

  // Apply overrides (e.g., corrected Content-Type)
  for (const [k, v] of Object.entries(overrides)) {
    res.setHeader(k, v);
  }
}

export default async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") {
      // Preflight
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Range,User-Agent,Accept,Origin,Referer");
      return res.status(204).end();
    }

    const targetUrl = req.query.url;
    if (!targetUrl) {
      return res.status(400).send("Missing url parameter");
    }

    // Forward Range (important for segment partial requests)
    const forwardHeaders = {
      "User-Agent":
        req.headers["user-agent"] ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
      Range: req.headers["range"] || undefined,
      Referer: req.headers["referer"] || undefined,
      Origin: req.headers["origin"] || undefined,
      // Some origins require Accept
      Accept: req.headers["accept"] || "*/*",
    };

    const upstream = await fetch(targetUrl, {
      method: req.method === "HEAD" ? "HEAD" : "GET",
      headers: Object.fromEntries(
        Object.entries(forwardHeaders).filter(([, v]) => v !== undefined)
      ),
    });

    let contentType = upstream.headers.get("content-type") || "";
    const urlLc = targetUrl.toLowerCase();

    // Buffers are easier since we may rewrite
    const arrBuf = await upstream.arrayBuffer();
    let body = Buffer.from(arrBuf);

    // Decide if MPD/HLS by content-type or file extension
    const isMPD =
      contentType.includes("mpd") ||
      contentType.includes("application/dash+xml") ||
      urlLc.endsWith(".mpd");
    const isM3U8 =
      contentType.includes("application/vnd.apple.mpegurl") ||
      contentType.includes("application/x-mpegurl") ||
      urlLc.endsWith(".m3u8");

    if (isMPD) {
      const xml = body.toString("utf8");
      const rewritten = rewriteMpd(xml, targetUrl);
      body = Buffer.from(rewritten, "utf8");
      // Normalize content-type for DASH
      contentType = "application/dash+xml";
      forwardHeaders(upstream, res, {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
      });
      return res.status(upstream.status).send(body);
    }

    if (isM3U8) {
      const text = body.toString("utf8");
      const rewritten = rewriteM3U8(text, targetUrl);
      body = Buffer.from(rewritten, "utf8");
      // Normalize content-type for HLS
      contentType = "application/vnd.apple.mpegurl";
      forwardHeaders(upstream, res, {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
      });
      return res.status(upstream.status).send(body);
    }

    // For media segments, keys, etc. → pass-through, keep byte ranges
    forwardHeaders(upstream, res, {
      "Cache-Control": upstream.headers.get("cache-control") || "public, max-age=30",
      "Content-Type": contentType || "application/octet-stream",
      "Accept-Ranges": upstream.headers.get("accept-ranges") || "bytes",
    });
    return res.status(upstream.status).send(body);
  } catch (err) {
    console.error("Proxy error:", err);
    return res.status(500).send("Proxy error");
  }
}
