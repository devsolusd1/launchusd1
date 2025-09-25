// /api/send-tx.js
import { Connection } from '@solana/web3.js'

// Normaliza o endpoint no topo (sem expor nada ao front)
const rawEndpoint = (process.env.RPC_ENDPOINT || '').trim();
const ENDPOINT = rawEndpoint.startsWith('http')
  ? rawEndpoint
  : 'https://api.mainnet-beta.solana.com';

export default async function handler(req, res) {
  res.setHeader('content-type', 'application/json');

  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST');
    return res.status(405).send(JSON.stringify({ ok: false, error: 'method not allowed' }));
  }

  try {
    // 1) tenta usar req.body; se não tiver, lê do stream
    let body = req.body;
    if (!body || (typeof body === 'string' && !body.trim())) {
      body = await readJson(req);
    } else if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch {}
    }

    const { txBase64, commitment = 'confirmed' } = body || {};
    if (!txBase64 || typeof txBase64 !== 'string' || txBase64.length < 16) {
      return res.status(400).send(JSON.stringify({ ok:false, error:'missing txBase64' }));
    }

    // 2) envia tx assinada via RPC do servidor
    const conn = new Connection(ENDPOINT, commitment);
    const raw = Buffer.from(txBase64, 'base64');
    const sig = await conn.sendRawTransaction(raw, { skipPreflight: false });
    const bh  = await conn.getLatestBlockhash(commitment);
    await conn.confirmTransaction({ signature: sig, ...bh }, commitment);

    return res.status(200).send(JSON.stringify({ ok:true, signature: sig }));
  } catch (e) {
    console.error('[send-tx] error:', e);
    return res.status(500).send(JSON.stringify({ ok:false, error: String(e?.message || e) }));
  }
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}
