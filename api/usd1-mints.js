// /api/usd1-mints.js
import { kv } from "@vercel/kv";
import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";

const KEY = "usd1:mintpool"; // LIST no KV

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type,authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    if (req.method === "POST") {
      // Aceita:
      // 1) { items: ["base58", ...] }
      // 2) ["base58", ...]   (array bruto)
      const buf = await new Response(req).arrayBuffer();
      let body = Buffer.from(buf).toString("utf8") || "[]";
      let parsed;
      try { parsed = JSON.parse(body); } catch { parsed = []; }
      const list = Array.isArray(parsed?.items) ? parsed.items
                  : Array.isArray(parsed) ? parsed : [];

      if (!list.length) return res.status(400).json({ ok:false, error:"no items" });

      let pushed = 0;
      for (const secret58 of list) {
        // valida formato e sufixo USD1 (opcional)
        try {
          const kp = Keypair.fromSecretKey(bs58.decode(String(secret58)));
          const pub = kp.publicKey.toBase58();
          // opcional: avisar se não termina em USD1 (não bloqueia)
          if (!pub.endsWith("USD1")) console.warn("[warn] vanity não termina em USD1:", pub);
          await kv.lpush(KEY, String(secret58));
          pushed++;
        } catch (e) {
          console.warn("ignorado item inválido:", e?.message || e);
        }
      }
      return res.status(200).json({ ok:true, pushed });
    }

    if (req.method === "GET") {
      // Apenas estatísticas (sem retornar secrets)
      const count = await kv.llen(KEY);
      return res.status(200).json({ ok:true, available: count });
    }

    if (req.method === "DELETE") {
      // Remove 1 do topo (para testes/rollback)
      const popped = await kv.lpop(KEY);
      return res.status(200).json({ ok:true, popped: !!popped });
    }

    return res.status(405).json({ ok:false, error:"Method not allowed" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok:false, error:String(e?.message||e) });
  }
}
