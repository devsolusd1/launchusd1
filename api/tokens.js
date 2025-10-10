import { kv } from '@vercel/kv';

const ORDER_KEY = process.env.TOKENS_ORDER_KEY || 'usd1:tokens:order';
const HASH_PREFIX = process.env.TOKENS_HASH_PREFIX || 'usd1:token:';
const ALLOWED_PLATFORM_ID_RAW = (process.env.RAYDIUM_PLATFORM_ID || 'Aw6YeyBLS8DezH3nigshkisj91vmvdaE4jyajZJNVNtW').trim();

const PINATA_GATEWAY = (process.env.PINATA_GATEWAY || 'https://coffee-bright-lungfish-824.mypinata.cloud/ipfs').replace(/\/+$/, '');

const norm = (s) => String(s || '').trim();
const eq = (a, b) => norm(a).toLowerCase() === norm(b).toLowerCase();

function extractCid(u) {
  if (!u) return '';
  const s = String(u).trim();
  if (s.startsWith('ipfs://')) {
    return s.slice(7).replace(/^ipfs\//i, '');
  }
  const m = s.match(/\/ipfs\/([^/?#]+)/i);
  return m ? m[1] : '';
}

function toGateway(u) {
  if (!u) return '';
  const s = String(u).trim();
  if (/^https?:\/\//i.test(s)) return s;
  const cid = extractCid(s);
  return cid ? `${PINATA_GATEWAY}/${cid}` : s;
}

export default async function handler(req, res) {
  res.setHeader('content-type', 'application/json');

  if (req.method === 'POST') {
    try {
      let body = req.body;
      if (!body || (typeof body === 'string' && !body.trim())) {
        body = await readJson(req);
      } else if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { }
      }

      const { mint, name, symbol, image, creator, platformId, mintSource, metadata } = body || {};

      if (!mint || !name || !symbol) {
        return res.status(400).json({ ok: false, error: 'missing fields' });
      }

      const allowedSet = Boolean(ALLOWED_PLATFORM_ID_RAW);
      const srcOk = mintSource === 'kv' || mintSource === 'generated';
      const pidOk = allowedSet ? eq(platformId, ALLOWED_PLATFORM_ID_RAW) : true;

      if (!srcOk || !pidOk) {
        return res.status(403).json({
          ok: false,
          error: `rejected: ${!srcOk ? 'mintSource must be kv|generated' : 'platformId mismatch'}`
        });
      }

      const ts = Date.now();
      const key = HASH_PREFIX + mint;

      await kv.hset(key, {
        mint,
        name,
        symbol,
        image: toGateway(image || ''),
        metadata: String(metadata || ''),
        creator: creator || '',
        platformId: norm(platformId),
        mintSource,
        createdAt: String(ts)
      });

      await kv.lrem(ORDER_KEY, 0, mint);
      await kv.lpush(ORDER_KEY, mint);

      return res.status(200).json({ ok: true, mint });
    } catch (e) {
      console.error('[tokens POST] error:', e);
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }

  if (req.method === 'GET') {
    try {
      const url = new URL(req.url, 'http://x');
      const pageSize = Math.max(1, Math.min(50, Number(url.searchParams.get('pageSize') || 12)));
      const page = Math.max(1, Number(url.searchParams.get('page') || 1));

      const mints = await kv.lrange(ORDER_KEY, 0, -1);
      const tokens = [];

      for (const m of mints) {
        const t = await kv.hgetall(HASH_PREFIX + m);
        if (!t || !t.mint) continue;

        const allowedSet = Boolean(ALLOWED_PLATFORM_ID_RAW);
        const srcOk = t.mintSource === 'kv' || t.mintSource === 'generated';
        const pidOk = allowedSet ? eq(t.platformId, ALLOWED_PLATFORM_ID_RAW) : true;
        if (!srcOk || !pidOk) continue;

        tokens.push({
          mint: t.mint,
          name: t.name,
          symbol: t.symbol,
          image: toGateway(t.image || ''),
          metadata: t.metadata || '',
          creator: t.creator || '',
          createdAt: Number(t.createdAt || 0),
          platformId: t.platformId,
          mintSource: t.mintSource,
          marketCap: 0
        });
      }

      const total = tokens.length;
      const start = (page - 1) * pageSize;
      const slice = tokens.slice(start, start + pageSize);

      return res.status(200).json({ ok: true, total, page, pageSize, items: slice });
    } catch (e) {
      console.error('[tokens GET] error:', e);
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }

  res.setHeader('allow', 'GET,POST');
  return res.status(405).json({ ok: false, error: 'method not allowed' });
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}
