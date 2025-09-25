export default async function handler(req, res) {
  res.setHeader('content-type', 'application/json');
  res.status(200).send(JSON.stringify({
    has_PINATA_JWT: Boolean(process.env.PINATA_JWT),
    has_RPC_ENDPOINT: Boolean(process.env.RPC_ENDPOINT),
    has_USD1_MINT: Boolean(process.env.USD1_MINT)
  }));
}
