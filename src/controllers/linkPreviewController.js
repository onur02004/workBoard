const dns = require("node:dns").promises;
const net = require("node:net");

const MAX_BODY_BYTES = 512 * 1024;
const REQUEST_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 5;

function ipv4ToNumber(address) {
    return address.split(".").reduce((result, part) => ((result << 8) | Number(part)) >>> 0, 0);
}

function inIpv4Range(address, base, prefix) {
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (ipv4ToNumber(address) & mask) === (ipv4ToNumber(base) & mask);
}

function isPublicAddress(address) {
    const version = net.isIP(address);
    if (version === 4) {
        const blocked = [
            ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10],
            ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
            ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16],
            ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
            ["224.0.0.0", 4], ["240.0.0.0", 4]
        ];
        return !blocked.some(([base, prefix]) => inIpv4Range(address, base, prefix));
    }
    if (version === 6) {
        const value = address.toLowerCase().split("%")[0];
        // Reject local, multicast, unique-local, link-local and IPv4-mapped ranges.
        return value !== "::" && value !== "::1" &&
            !value.startsWith("fc") && !value.startsWith("fd") &&
            !value.startsWith("fe8") && !value.startsWith("fe9") &&
            !value.startsWith("fea") && !value.startsWith("feb") &&
            !value.startsWith("ff") && !value.startsWith("::ffff:");
    }
    return false;
}

async function assertPublicHost(hostname) {
    const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
        throw new Error("Local and private network addresses are not allowed.");
    }

    if (net.isIP(host)) {
        if (!isPublicAddress(host)) throw new Error("Private network addresses are not allowed.");
        return;
    }

    const records = await dns.lookup(host, { all: true, verbatim: true });
    if (!records.length || records.some((record) => !isPublicAddress(record.address))) {
        throw new Error("The URL must resolve to a public address.");
    }
}

function decodeHtml(value) {
    return String(value || "")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
        .replace(/&#x([\da-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)))
        .replace(/\s+/g, " ")
        .trim();
}

function readAttribute(tag, attribute) {
    const escaped = attribute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = tag.match(new RegExp(`\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
    return match ? (match[1] ?? match[2] ?? match[3] ?? "") : "";
}

function findMeta(html, key, attribute = "property") {
    const tags = html.match(/<meta\b[^>]*>/gi) || [];
    for (const tag of tags) {
        const name = readAttribute(tag, attribute).toLowerCase();
        if (name === key.toLowerCase()) return decodeHtml(readAttribute(tag, "content"));
    }
    return "";
}

function findIcon(html, baseUrl) {
    const tags = html.match(/<link\b[^>]*>/gi) || [];
    for (const tag of tags) {
        const rel = readAttribute(tag, "rel").toLowerCase();
        const href = readAttribute(tag, "href");
        if (href && (rel.includes("icon") || rel.includes("apple-touch-icon"))) {
            try {
                const candidate = new URL(href, baseUrl);
                if (["http:", "https:"].includes(candidate.protocol)) return candidate.href;
            } catch { /* ignore invalid metadata */ }
        }
    }
    return new URL("/favicon.ico", baseUrl).href;
}

async function readLimited(response) {
    if (!response.body) return "";
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
        while (size < MAX_BODY_BYTES) {
            const { done, value } = await reader.read();
            if (done) break;
            const remaining = MAX_BODY_BYTES - size;
            const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value;
            chunks.push(Buffer.from(chunk));
            size += chunk.byteLength;
            if (value.byteLength > remaining) break;
        }
    } finally {
        await reader.cancel().catch(() => {});
    }
    return Buffer.concat(chunks).toString("utf8");
}

function responseForStatus(status, url) {
    return {
        url,
        status,
        http_status: null,
        title: new URL(url).hostname,
        description: "",
        favicon_url: new URL("/favicon.ico", url).href,
        image_url: null
    };
}

exports.getLinkPreview = async (req, res) => {
    const rawUrl = String(req.query.url || "").trim();
    if (!rawUrl || rawUrl.length > 2048) {
        return res.status(400).json({ message: "A valid URL is required." });
    }

    let requestedUrl;
    try {
        requestedUrl = new URL(rawUrl);
        if (!(["http:", "https:"].includes(requestedUrl.protocol)) || requestedUrl.username || requestedUrl.password) {
            throw new Error("Only public HTTP and HTTPS links are supported.");
        }
    } catch (error) {
        return res.status(400).json({ message: error.message || "Invalid URL." });
    }

    let currentUrl = requestedUrl;
    try {
        for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
            await assertPublicHost(currentUrl.hostname);
            const response = await fetch(currentUrl, {
                    method: "GET",
                    redirect: "manual",
                    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
                    headers: {
                        "User-Agent": "WorkboardLinkPreview/1.0",
                        "Accept": "text/html,application/xhtml+xml,image/avif,image/webp,image/*;q=0.8,*/*;q=0.5",
                        "Range": `bytes=0-${MAX_BODY_BYTES - 1}`
                    }
                });

            if (response.status >= 300 && response.status < 400) {
                const location = response.headers.get("location");
                if (!location || redirects === MAX_REDIRECTS) {
                    return res.json(responseForStatus("unavailable", currentUrl.href));
                }
                currentUrl = new URL(location, currentUrl);
                continue;
            }

            if (response.status === 401 || response.status === 407) {
                return res.json({ ...responseForStatus("auth_required", currentUrl.href), http_status: response.status });
            }
            if (response.status === 403) {
                return res.json({ ...responseForStatus("restricted", currentUrl.href), http_status: 403 });
            }
            if (response.status === 429) {
                return res.json({ ...responseForStatus("rate_limited", currentUrl.href), http_status: 429 });
            }
            if (!response.ok) {
                return res.json({ ...responseForStatus("unavailable", currentUrl.href), http_status: response.status });
            }

            const contentType = (response.headers.get("content-type") || "").toLowerCase();
            if (contentType.startsWith("image/")) {
                return res.json({
                    ...responseForStatus("public", currentUrl.href),
                    http_status: response.status,
                    title: decodeURIComponent(currentUrl.pathname.split("/").pop() || currentUrl.hostname),
                    image_url: currentUrl.href,
                    content_type: contentType
                });
            }

            if (!contentType.includes("html") && !contentType.includes("xhtml")) {
                return res.json({
                    ...responseForStatus("public", currentUrl.href),
                    http_status: response.status,
                    title: currentUrl.hostname,
                    content_type: contentType
                });
            }

            const html = await readLimited(response);
            const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
            const title = findMeta(html, "og:title") || findMeta(html, "twitter:title", "name") || decodeHtml(titleMatch?.[1] || "") || currentUrl.hostname;
            const description = findMeta(html, "og:description") || findMeta(html, "description", "name") || findMeta(html, "twitter:description", "name");
            const image = findMeta(html, "og:image") || findMeta(html, "twitter:image", "name");
            let imageUrl = null;
            if (image) {
                try {
                    const candidate = new URL(image, currentUrl);
                    if (["http:", "https:"].includes(candidate.protocol)) {
                        await assertPublicHost(candidate.hostname);
                        imageUrl = candidate.href;
                    }
                } catch { /* ignore invalid or private image URLs */ }
            }
            let faviconUrl = findIcon(html, currentUrl);
            try { await assertPublicHost(new URL(faviconUrl).hostname); }
            catch { faviconUrl = new URL("/favicon.ico", currentUrl).href; }
            const hasPassword = /<input\b[^>]*type\s*=\s*["']?password/i.test(html);
            const looksLikeLogin = hasPassword && /(sign[ -]?in|log[ -]?in|authentication|giriş yap|oturum aç)/i.test(`${title} ${currentUrl.pathname}`);
            const status = looksLikeLogin ? "auth_required" : "public";

            return res.json({
                url: currentUrl.href,
                status,
                http_status: response.status,
                title,
                description,
                favicon_url: faviconUrl,
                image_url: imageUrl,
                site_name: findMeta(html, "og:site_name") || currentUrl.hostname,
                content_type: contentType
            });
        }
    } catch (error) {
        const status = ["AbortError", "TimeoutError"].includes(error.name) ? "timeout" : "unavailable";
        const data = responseForStatus(status, currentUrl.href);
        data.message = status === "timeout" ? "The website took too long to respond." : error.message;
        return res.json(data);
    }
};
