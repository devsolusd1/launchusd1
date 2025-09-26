// /api/claim-creator-fee.js
import { Connection, PublicKey } from "@solana/web3.js";
import { Raydium, LAUNCHPAD_PROGRAM, TxVersion } from "@raydium-io/raydium-sdk-v2";
import { kv } from "@vercel/kv";

const ORDER_KEY = process.env.TOKENS_ORDER_KEY || 'usd1:tokens:order';
const HASH_PREFIX = process.env.TOKENS_HASH_PREFIX || 'usd1:token:';

const ENV = {
  RPC_ENDPOINT: (process.env.RPC_ENDPOINT || "").trim(),
  USD1_MINT: (process.env.USD1_MINT || "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB").trim(),
};

const ENDPOINT = ENV.RPC_ENDPOINT.startsWith("http")
  ? ENV.RPC_ENDPOINT
  : "https://api.mainnet-beta.solana.com";

function u8ToB64(u8) {
  return Buffer.from(u8).toString("base64");
}

// Confere se a carteira já fez deploy pelo seu site
async function isCreatorEligible(creatorBase58) {
  const setKey = `usd1:creator:${creatorBase58}:mints`;
  try {
    const mints = await kv.smembers(setKey);
    if (Array.isArray(mints) && mints.length > 0) return true;
  } catch {}

  // Backfill a partir do storage de /api/tokens
  try {
    const order = await kv.lrange(ORDER_KEY, 0, -1);
    const mine = [];
    for (const m of order || []) {
      const t = await kv.hgetall(HASH_PREFIX + m);
      if (t?.creator && t.creator === creatorBase58) mine.push(m);
    }
    if (mine.length) {
      await kv.sadd(setKey, ...mine);
      return true;
    }
  } catch {}

  return false;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type,authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok:false, error:"Use POST" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const payer = (body.payer || "").trim();
    if (!payer) return res.status(400).json({ ok:false, error:"payer required" });

    const eligible = await isCreatorEligible(payer);
    if (!eligible) {
      return res.status(403).json({ ok:false, reason:"not-eligible", error:"Wallet hasn't deployed here" });
    }

    const conn = new Connection(ENDPOINT, "confirmed");
    const raydium = await Raydium.load({
      connection: conn,
      owner: new PublicKey(payer),
      cluster: "mainnet",
    });

    const { transaction } = await raydium.launchpad.claimCreatorFee({
      programId: LAUNCHPAD_PROGRAM,
      mintB: new PublicKey(ENV.USD1_MINT),
      txVersion: TxVersion.V0,
    });

    const txBase64 = u8ToB64(transaction.serialize());
    return res.status(200).json({ ok:true, txsBase64:[txBase64] });
  } catch (e) {
    console.error(e);
    return res.status(200).json({ ok:false, error:String(e?.message || e) });
  }
}
