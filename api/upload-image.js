// /api/upload-image.js
const PINATA_JWT = process.env.PINATA_JWT; // <- DECLARADO NO TOPO

export default async function handler(req, res) {
  // CORS básico
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "content-type,authorization");
    return res.status(200).end();
  }
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("content-type", "application/json");

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Use POST" });
    }
    if (!PINATA_JWT) {
      // em dev, mostre que está faltando; em prod só 500 genérico se preferir
      return res.status(500).json({ ok:false, error:"PINATA_JWT missing (check .env.local or Vercel env)" });
    }

    // lê body (string, objeto ou stream)
    let body = req.body;
    if (!body || (typeof body === "string" && !body.trim())) body = await readJson(req);
    if (typeof body === "string") body = JSON.parse(body);
    const { filename, contentType, base64 } = body || {};
    if (!filename || !contentType || !base64) {
      return res.status(400).json({ ok:false, error:"missing: filename, contentType, base64" });
    }

    const bytes = Buffer.from(base64, "base64");
    const form = new FormData();
    const file = new File([bytes], filename, { type: contentType });
    form.append("file", file);

    const resp = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
      method: "POST",
      headers: { authorization: `Bearer ${PINATA_JWT}` },
      body: form,
    });
    if (!resp.ok) {
      const t = await resp.text().catch(()=> "");
      return res.status(resp.status).json({ ok:false, error:`Pinata error ${resp.status}: ${t}` });
    }
    const j = await resp.json();
    const cid = j?.IpfsHash;
    if (!cid) return res.status(500).json({ ok:false, error:"Pinata: missing IpfsHash" });

    return res.status(200).json({ ok:true, imageUri: `https://coffee-bright-lungfish-824.mypinata.cloud/ipfs/${cid}` });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok:false, error: String(e?.message || e) });
  }
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw || "{}");
}
