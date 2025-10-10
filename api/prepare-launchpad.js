import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import bs58 from "bs58";
import BN from "bn.js";

import { Connection, PublicKey, Keypair, Transaction } from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  TxVersion,
  getPdaLaunchpadConfigId,
  LaunchpadConfig,
  LAUNCHPAD_PROGRAM,
  CpmmCreatorFeeOn,
  Raydium,
} from "@raydium-io/raydium-sdk-v2";
import { kv } from "@vercel/kv";

const ENV = {
  RPC_ENDPOINT: (process.env.RPC_ENDPOINT || "").trim(),
  PINATA_JWT: (process.env.PINATA_JWT || "").trim(),
  USD1_MINT: (process.env.USD1_MINT || "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB").trim(),
  PINATA_GATEWAY: (process.env.PINATA_GATEWAY || "https://coffee-bright-lungfish-824.mypinata.cloud/ipfs").trim(),
  CREATED_ON: (process.env.CREATED_ON || "launchusd1.fun").trim(),
  RAYDIUM_PLATFORM_ID: (process.env.RAYDIUM_PLATFORM_ID || "Aw6YeyBLS8DezH3nigshkisj91vmvdaE4jyajZJNVNtW").trim(),
  MINTPOOL_KEY: process.env.MINTPOOL_KEY || "usd1:mintpool",
};

const TWITTER_URL_ENV = (process.env.TWITTER_URL || "").trim();
const TWITTER_HANDLE_ENV = (process.env.TWITTER_HANDLE || "").trim();
const MINTPOOL_KEY = (process.env.MINTPOOL_KEY || 'usd1:mintpool').trim();

const ENDPOINT = ENV.RPC_ENDPOINT.startsWith("http")
  ? ENV.RPC_ENDPOINT
  : "https://api.mainnet-beta.solana.com";

const USD1_MINT_PK = new PublicKey(ENV.USD1_MINT);
const PLATFORM_ID = new PublicKey(ENV.RAYDIUM_PLATFORM_ID);
const IS_PROD = process.env.NODE_ENV === "production";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
function rootPath(...p) { return path.join(__dirname, "..", ...p); }

async function readJsonFromReq(req) {
  let body = req.body;
  if (!body || (typeof body === "string" && !body.trim())) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString("utf8");
    body = raw ? JSON.parse(raw) : {};
  } else if (typeof body === "string") {
    body = JSON.parse(body);
  }
  return body;
}

function extractCid(u) {
  if (!u) return "";
  if (u.startsWith("ipfs://")) return u.slice(7);
  const m = u.match(/\/ipfs\/([^/?#]+)/i);
  return m ? m[1] : "";
}

function toGatewayUrl(u) {
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  const cid = extractCid(u);
  if (!cid) return "";
  const base = ENV.PINATA_GATEWAY.replace(/\/+$/, "");
  return `${base}/${cid}`;
}

function normalizeTwitter(urlOrHandle) {
  if (!urlOrHandle) return "";
  const s = urlOrHandle.trim();
  if (/^https?:\/\//i.test(s)) return s.replace("twitter.com", "x.com");
  const h = s.startsWith("@") ? s.slice(1) : s;
  return `https://x.com/${h}`;
}

function loadLocalMints() {
  try {
    const p = rootPath("usd1-mints.local.json");
    if (!fs.existsSync(p)) return [];
    const raw = fs.readFileSync(p, "utf8");
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter(Boolean) : [];
  } catch { return []; }
}
function saveLocalMints(arr) {
  try {
    const p = rootPath("usd1-mints.local.json");
    fs.writeFileSync(p, JSON.stringify(arr, null, 2));
  } catch { }
}

async function allocateMintKeypair() {
  try {
    const secret58 = await kv.lpop(ENV.MINTPOOL_KEY);
    if (secret58) {
      const kp = Keypair.fromSecretKey(bs58.decode(String(secret58)));
      return { kp, source: 'kv' };
    }
  } catch (e) {
    console.warn('[KV] failed to read', ENV.MINTPOOL_KEY, e?.message || e);
  }
  console.warn('[FALLBACK] empty pool → using Keypair.generate()');
  return { kp: Keypair.generate(), source: 'generated' };
}

async function pinJsonToIPFS(obj) {
  const r = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${ENV.PINATA_JWT}`,
    },
    body: JSON.stringify(obj),
  });
  if (!r.ok) throw new Error(`Pinata JSON failed ${r.status}`);
  const j = await r.json();
  return 'ipfs://' + j.IpfsHash;
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "content-type,authorization");
    return res.status(200).end();
  }
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Use POST" });

  try {
    const body = await readJsonFromReq(req);
    const { payer, name, symbol, image, buyAmountUsd1 } = body || {};

    if (!payer) throw new Error("payer required");
    if (!name || !symbol) throw new Error("name/symbol required");

    const payerPk = new PublicKey(payer);
    const conn = new Connection(ENDPOINT, "confirmed");

    const twitterUrl = normalizeTwitter(TWITTER_URL_ENV || TWITTER_HANDLE_ENV);

    const imageHttps = toGatewayUrl(image);
    const ext = (image?.split(".").pop() || "").toLowerCase();
    const mime =
      ext === "png" ? "image/png" :
        ext === "jpg" ? "image/jpeg" :
          ext === "jpeg" ? "image/jpeg" :
            ext === "gif" ? "image/gif" :
              ext === "webp" ? "image/webp" :
                "image/png";

    const { kp: mintAKp, source: mintSource } = await allocateMintKeypair();
    const mintA = mintAKp.publicKey;
    const metadataObj = {
      "created on": ENV.CREATED_ON,
      name,
      symbol,
      description: `${name} (${symbol})`,
      image: imageHttps || ""
    };
    const metadataUri = await pinJsonToIPFS(metadataObj);

    const mintB = USD1_MINT_PK;
    const ataUSD1 = await getAssociatedTokenAddress(mintB, payerPk, false);
    const { blockhash } = await conn.getLatestBlockhash("finalized");
    const txATA = new Transaction({ feePayer: payerPk, recentBlockhash: blockhash });
    txATA.add(
      createAssociatedTokenAccountIdempotentInstruction(
        payerPk, ataUSD1, payerPk, mintB, TOKEN_PROGRAM_ID
      )
    );
    const txAtaB64 = Buffer.from(txATA.serialize({ requireAllSignatures: false })).toString("base64");

    const configId = getPdaLaunchpadConfigId(LAUNCHPAD_PROGRAM, mintB, 0, 0).publicKey;
    const configAcc = await conn.getAccountInfo(configId);
    if (!configAcc) throw new Error("Raydium config not found (configId)");
    const configInfo = LaunchpadConfig.decode(configAcc.data);

    const raydium = await Raydium.load({
      connection: conn,
      owner: payerPk,
      cluster: "mainnet",
    });

    const DECIMALS_A = 6;
    const DECIMALS_B = 6;
    const toUnits = (val, decimals) => {
      if (typeof val === "string") val = val.replace(",", ".").trim();
      const n = Number(val);
      if (!Number.isFinite(n)) throw new Error(`invalid value: ${val}`);
      return new BN(Math.round(n * Math.pow(10, decimals)));
    };
    const toA = (v) => toUnits(v, DECIMALS_A);
    const toB = (v) => toUnits(v, DECIMALS_B);

    const rawBuyStr = String(buyAmountUsd1 ?? "0").replace(",", ".");
    const rawBuy = Number(rawBuyStr);
    let createOnly = false;
    let buyAmount = new BN(0);
    if (!Number.isFinite(rawBuy) || rawBuy <= 0) {
      createOnly = true;
    } else {
      buyAmount = toB(rawBuy);
    }

    const supply = toA(1_000_000_000);
    const totalSellA = toA(793_100_000);
    const totalFundRaisingB = toB(18_287);
    const totalLockedAmount = new BN(0);
    const cliffPeriod = new BN(0);
    const unlockPeriod = new BN(0);

    const { transactions, extInfo } = await raydium.launchpad.createLaunchpad({
      programId: LAUNCHPAD_PROGRAM,
      mintA,
      decimals: DECIMALS_A,
      name,
      symbol,
      migrateType: "cpmm",
      uri: metadataUri,
      configId,
      configInfo,
      mintBDecimals: DECIMALS_B,
      platformId: PLATFORM_ID,
      txVersion: TxVersion.V0,
      slippage: new BN(100),
      buyAmount: createOnly ? undefined : buyAmount,
      associatedOnly: true,
      checkCreateATAOwner: false,
      creatorFeeOn: CpmmCreatorFeeOn.OnlyTokenB,
      extraSigners: [mintAKp],
      computeBudgetConfig: { units: 600000, microLamports: 46591500 },
      extraConfigs: {
        supply,
        totalSellA,
        totalFundRaisingB,
        totalLockedAmount,
        cliffPeriod,
        unlockPeriod,
      },
    });

    const txsBase64 = [
      txAtaB64,
      ...transactions.map((tx) => Buffer.from(tx.serialize()).toString("base64")),
    ];

    return res.status(200).json({
      ok: true,
      mint: mintA.toBase58(),
      platformId: PLATFORM_ID.toBase58(),
      mintSource: mintSource || 'generated',
      metadataUri,
      body: {
        txsBase64,
        extInfo,
      },
    });

  } catch (e) {
    console.error(e && e.stack ? e.stack : e);
    return res.status(200).json({ ok: false, error: String(e?.message || e) });
  }
}
