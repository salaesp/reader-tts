import { isTtsProvider } from '../../../shared/types'
import type { Api } from '../../lib/env'
import { json, requireUser } from '../../lib/http'
import { getApiKeyFromRow, loadSettingsRow, providerOf } from '../../lib/settings'
import { clientFor } from '../../lib/tts'

/** Enough of the upstream response to see where voices live, not a data dump. */
const DEBUG_MODELS = 3

/**
 * Lists the models the selected provider can synthesize with, so the Settings
 * screen never has to hardcode a model id. `?provider=` overrides the stored
 * selection, which is what lets Settings show one provider's catalogue while
 * another is still the active one.
 *
 * `?raw=1` returns the provider's own response for the first few models
 * instead. Voices are not in OpenRouter's documented schema, so when a model's
 * list comes back guessed — and a guessed voice is a 400 that says nothing
 * about the voice — this is how to find out what the provider actually sends
 * without reaching for curl and an API key. It exposes public catalogue
 * metadata only; the key stays in the Worker.
 */
export const onRequestGet: Api = async ({ request, env, data }) => {
  const user = requireUser(data.user)

  const params = new URL(request.url).searchParams
  const requested = params.get('provider')
  const settings = await loadSettingsRow(env, user.id)
  const provider = isTtsProvider(requested) ? requested : providerOf(settings)

  const apiKey = await getApiKeyFromRow(env, settings, provider)
  const client = clientFor(provider)

  if (params.get('raw') === '1') {
    const sample = await client.rawModels?.(apiKey, DEBUG_MODELS)
    return json({ provider, raw: sample ?? null })
  }

  const models = await client.listModels(apiKey)
  return json({ provider, models }, { headers: { 'cache-control': 'private, max-age=600' } })
}
