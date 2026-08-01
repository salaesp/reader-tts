/**
 * Stops a command that is guaranteed to fail against Cloudflare.
 *
 * The D1 and KV ids belong to the account, so they cannot ship in the repo and
 * `wrangler.toml` carries placeholders instead. Every command that reaches
 * those resources — deploying, applying migrations, listing them — fails on the
 * placeholder, and what comes back describes the shape of the value
 * ("Invalid uuid") rather than the step that was skipped.
 *
 * Usage: `node scripts/check-bindings.mjs [d1|kv]…`
 * With no argument every binding is checked; naming one narrows it, so
 * applying migrations does not demand a KV namespace it never touches.
 */
import { readFileSync } from 'node:fs'

const CONFIG = 'wrangler.toml'

const BINDINGS = {
  d1: {
    placeholder: 'PASTE_D1_DATABASE_ID',
    what: 'The D1 database id is still the placeholder.',
    fix: 'npx wrangler d1 create reader-tts   # paste database_id into wrangler.toml',
  },
  kv: {
    placeholder: 'PASTE_KV_NAMESPACE_ID',
    what: 'The KV namespace id is still the placeholder.',
    fix: 'npx wrangler kv namespace create FILES   # paste the id into wrangler.toml',
  },
}

const requested = process.argv.slice(2)
const names = requested.length > 0 ? requested : Object.keys(BINDINGS)

const unknown = names.filter((name) => !(name in BINDINGS))
if (unknown.length > 0) {
  console.error(`check-bindings: unknown binding ${unknown.join(', ')}`)
  process.exit(2)
}

const config = readFileSync(CONFIG, 'utf8')
const problems = names.map((name) => BINDINGS[name]).filter((b) => config.includes(b.placeholder))

if (problems.length > 0) {
  console.error(`\n${CONFIG} is not ready:\n`)
  for (const { what, fix } of problems) {
    console.error(`  • ${what}`)
    console.error(`    ${fix}\n`)
  }
  console.error('These ids are specific to your Cloudflare account and cannot be')
  console.error('committed ahead of time. See "2. Cloudflare" in the README.\n')
  process.exit(1)
}
