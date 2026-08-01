/**
 * Stops a deploy that is guaranteed to fail.
 *
 * Cloudflare validates bindings when it receives the deploy, so a database_id
 * or namespace id that does not exist in the account rejects every deploy
 * identically — the code being deployed never enters into it. That failure
 * reads as "the deploy is broken" rather than "this one line is wrong", which
 * is an expensive thing to debug from the build log alone.
 *
 * Run by `npm run pages:deploy`. Checks nothing about the code; the build and
 * the test suite already cover that.
 */
import { readFileSync } from 'node:fs'

const CONFIG = 'wrangler.toml'
const config = readFileSync(CONFIG, 'utf8')

const problems = []

if (config.includes('PASTE_D1_DATABASE_ID')) {
  problems.push({
    what: 'The D1 database id is still the placeholder.',
    fix: 'npx wrangler d1 create reader-tts   # paste database_id into wrangler.toml',
  })
}

if (config.includes('PASTE_KV_NAMESPACE_ID')) {
  problems.push({
    what: 'The KV namespace id is still the placeholder.',
    fix: 'npx wrangler kv namespace create FILES   # paste the id into wrangler.toml',
  })
}

if (problems.length > 0) {
  console.error(`\n${CONFIG} is not ready to deploy:\n`)
  for (const { what, fix } of problems) {
    console.error(`  • ${what}`)
    console.error(`    ${fix}\n`)
  }
  console.error('Both ids are specific to your Cloudflare account and cannot be')
  console.error('committed ahead of time. See "Desplegar" in the README.\n')
  process.exit(1)
}
