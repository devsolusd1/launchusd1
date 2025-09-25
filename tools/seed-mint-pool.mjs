// tools/seed-mint-pool.mjs
import { config as load } from 'dotenv'
load({ path: '.env.local' })            // 1) carrega as envs

// 2) só agora importe o cliente KV (ele lê as envs na importação)
const { kv } = await import('@vercel/kv')

import fs from 'node:fs/promises'

const KEY = 'usd1:mintpool'

async function main() {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    throw new Error('KV_REST_API_URL / KV_REST_API_TOKEN ausentes')
  }

  const raw = await fs.readFile('./mints-arrays.json', 'utf8')
  const arr = JSON.parse(raw)
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new Error('mint-arrays.json vazio')
  }

  // opcional: limpar estoque anterior
  // await kv.del(KEY)

  for (const secret58 of arr) {
    const s = String(secret58 || '').trim()
    if (!s) continue
    await kv.lpush(KEY, s)
  }

  const len = await kv.llen(KEY)
  console.log(`OK! Estoque atual: ${len} vanity mints em ${KEY}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
