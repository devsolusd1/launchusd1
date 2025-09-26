const JUP_BASE = process.env.JUP_API_BASE || "https://lite-api.jup.ag";
const TOKEN_SEARCH_URL = `${JUP_BASE}/tokens/v2/search`;

const fs = require("node:fs/promises");
const path = require("node:path");

function unique(arr) {
  return [...new Set(arr.filter(Boolean))];
}

async function readTokensJSON() {
  try {
    const p = path.join(process.cwd(), "tokens.json");
    const raw = await fs.readFile(p, "utf8");
    const data = JSON.parse(raw);
    if (Array.isArray(data)) {
      return unique(
        data
          .map((t) => (typeof t === "string" ? t : t?.mint))
          .filter(Boolean)
      );
    }
    if (data && typeof data === "object" && data.mint) return [String(data.mint)];
    return [];
  } catch {
    return [];
  }
}

async function jupFetch(url, retries = 3) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (res.ok) return res.json();
  if (retries > 0 && (res.status === 429 || res.status >= 500)) {
    await new Promise((r) =>
      setTimeout(r, (4 - retries) * 400 + Math.floor(Math.random() * 250))
    );
    return jupFetch(url, retries - 1);
  }
  const text = await res.text().catch(() => "");
  throw new Error(`Jupiter Token API error ${res.status}: ${text}`);
}

async function getTokenInfoByMints(mints) {
  const out = {};
  for (const mint of unique(mints)) {
    try {
      const url = `${TOKEN_SEARCH_URL}?query=${encodeURIComponent(mint)}`;
      const data = await jupFetch(url);
      const hit = Array.isArray(data?.data)
        ? data.data.find((t) => t?.address === mint)
        : null;
      if (!hit) {
        out[mint] = {
          mint,
          name: null,
          symbol: null,
          logoURI: null,
          marketCap: null,
        };
        continue;
      }
      const mc =
        hit.marketCap && typeof hit.marketCap === "object"
          ? hit.marketCap.usd ?? null
          : typeof hit.marketCap === "number"
            ? hit.marketCap
            : null;

      out[mint] = {
        mint,
        name: hit.name ?? null,
        symbol: hit.symbol ?? null,
        logoURI: hit.logoURI || hit.logoUri || hit.image || null,
        marketCap: mc,
      };
    } catch (e) {
      out[mint] = {
        mint,
        name: null,
        symbol: null,
        logoURI: null,
        marketCap: null,
        error: String(e?.message || e),
      };
    }
  }
  return out;
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "s-maxage=30, stale-while-revalidate=60");
  res.end(JSON.stringify(body));
}

function jsonError(res, status, message, extra = {}) {
  json(res, status, { ok: false, error: message, ...extra });
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") {
    const ORIGIN = process.env.ALLOWED_ORIGIN || "https://launchusd1.fun";
    res.setHeader("Access-Control-Allow-Origin", ORIGIN);
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "content-type");
    res.statusCode = 200;
    return res.end();
  }
  res.setHeader("Access-Control-Allow-Origin", "*");

  try {
    const url = new URL(req.url, "http://localhost");
    const idsParam = url.searchParams.get("ids");

    let ids = [];
    if (idsParam) {
      ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean);
    }
    const fromFile = await readTokensJSON();
    ids = unique([...(ids || []), ...fromFile]);

    if (!ids.length)
      return jsonError(res, 400, "Provide ?ids=<mint,...> or fill tokens.json with an array of mints.");

    const metaMap = await getTokenInfoByMints(ids);
    const out = ids.map((mint) => metaMap[mint] || { mint });

    return json(res, 200, { ok: true, count: out.length, data: out });
  } catch (err) {
    console.error("/api/jupiter-tokeninfo.js error:", err);
    return jsonError(res, 500, "Failed to fetch Jupiter Token API v2.", {
      details: String(err?.message || err),
    });
  }
};
