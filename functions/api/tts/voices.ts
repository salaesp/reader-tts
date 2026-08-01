import type { TtsVoice, VoiceSource } from '../../../shared/types'
import { inferVoices, isTtsProvider } from '../../../shared/types'
import type { Api } from '../../lib/env'
import { HttpError, json, requireUser } from '../../lib/http'
import { getApiKeyFromRow, loadSettingsRow, modelOf, providerOf } from '../../lib/settings'
import { clientFor } from '../../lib/tts'

/**
 * Voices for one model.
 *
 * Separate from /api/tts/models because finding them can cost a request per
 * model — OpenRouter leaves `supported_voices` null in the catalogue and puts
 * the real answer behind each model's endpoints link. Asked for one model at a
 * time, that is one request when Settings needs it rather than nineteen every
 * time the screen opens.
 */
export const onRequestGet: Api = async ({ request, env, data }) => {
  const user = requireUser(data.user)

  const params = new URL(request.url).searchParams
  const settings = await loadSettingsRow(env, user.id)
  const provider = isTtsProvider(params.get('provider'))
    ? (params.get('provider') as ReturnType<typeof providerOf>)
    : providerOf(settings)
  const model = params.get('model')?.trim() || modelOf(settings, provider)
  if (!model) throw new HttpError(400, 'missing_model')

  const apiKey = await getApiKeyFromRow(env, settings, provider)
  const client = clientFor(provider)

  let voices: TtsVoice[] = []
  let source: VoiceSource = 'unknown'

  if (client.listVoices) {
    voices = await client.listVoices(apiKey, model)
    if (voices.length > 0) source = 'provider'
  }

  if (voices.length === 0) {
    voices = inferVoices(model)
    if (voices.length > 0) source = 'inferred'
  }

  return json({ model, provider, voices, source })
}
