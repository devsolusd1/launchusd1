import { Connection, PublicKey } from '@solana/web3.js'

const rawEndpoint = (process.env.RPC_ENDPOINT || '').trim();
const ENDPOINT = rawEndpoint.startsWith('http')
  ? rawEndpoint
  : 'https://mainnet.helius-rpc.com/?api-key=438a28f5-e5c2-4784-8e38-b070786599ca';

export default async function handler(req, res) {
  res.setHeader('content-type','application/json');
  try {
    const url   = new URL(req.url, 'http://x');
    const owner = url.searchParams.get('owner');
    const mint  = url.searchParams.get('mint');
    if (!owner || !mint) {
      return res.status(400).send(JSON.stringify({ ok:false, error:'owner & mint required' }));
    }

    const conn = new Connection(ENDPOINT, 'confirmed');
    const resp = await conn.getParsedTokenAccountsByOwner(new PublicKey(owner), { mint: new PublicKey(mint) });

    let total = 0;
    for (const { account } of resp.value) {
      const t = account?.data?.parsed?.info?.tokenAmount;
      if (!t) continue;
      if (typeof t.uiAmount === 'number') total += t.uiAmount;
      else if (typeof t.amount === 'string' && typeof t.decimals === 'number') total += Number(t.amount) / 10 ** t.decimals;
    }
    return res.status(200).send(JSON.stringify({ ok:true, uiAmount: total }));
  } catch (e) {
    console.error(e);
    return res.status(500).send(JSON.stringify({ ok:false, error: String(e.message || e) }));
  }
}
