#!/usr/bin/env node
// Who paid Fathom, for what, and as which client: a summary of the payment
// ledger the x402 middleware writes to KV (src/middleware/paymentLedger.ts).
//
//   node scripts/payment_ledger_report.js [days=30]
//
// Reads through the operator's own wrangler login (`wrangler kv key list/get
// --remote`), prints counts only, and cuts every address short. Nothing is
// written.

const { execFileSync } = require('node:child_process')

const days = Number(process.argv[2] ?? 30)
const since = new Date(Date.now() - days * 86_400_000).toISOString()
const wrangler = (args) => execFileSync('npx', ['wrangler', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const mask = (address) => (address ? `${address.slice(0, 6)}…${address.slice(-4)}` : 'unknown')
const family = (ua) => (ua ? ua.split(/[ /;(]/)[0] || ua.slice(0, 30) : '(none)')

const keys = JSON.parse(wrangler(['kv', 'key', 'list', '--binding', 'FATHOM_KV', '--prefix', 'ledger:v1:', '--remote']))
  .map((entry) => entry.name)
  .filter((name) => name.slice('ledger:v1:'.length) >= since)

const entries = keys.map((name) => JSON.parse(wrangler(['kv', 'key', 'get', name, '--binding', 'FATHOM_KV', '--remote'])))
const count = (by) => entries.reduce((map, entry) => map.set(by(entry), (map.get(by(entry)) ?? 0) + 1), new Map())
const show = (title, map) => {
  console.log(`\n${title}`)
  for (const [key, n] of [...map].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${key}`)
}

console.log(`${entries.length} settled payments since ${since.slice(0, 10)}`)
show('by client (User-Agent family)', count((entry) => family(entry.userAgent)))
show('by endpoint', count((entry) => entry.path))
show('by payer', count((entry) => mask(entry.payer)))
show('by day (UTC)', count((entry) => entry.at.slice(0, 10)))
