import type { TtsPricing, TtsProvider } from '../../shared/types'
import { api } from './api'

/**
 * The price of a model, for screens outside Settings.
 *
 * The catalogue is the only place prices live, and it is the only place they
 * should live: copying them into stored settings is what produced a cache
 * serving a shape the code no longer understood. Instead the request is shared
 * — one per provider per session, with concurrent callers awaiting the same
 * promise rather than each firing their own.
 */

type Catalogue = Map<string, TtsPricing | null>

const loaded = new Map<TtsProvider, Catalogue>()
const inFlight = new Map<TtsProvider, Promise<Catalogue>>()

function fetchCatalogue(provider: TtsProvider): Promise<Catalogue> {
  const existing = inFlight.get(provider)
  if (existing) return existing

  const request = api
    .listTtsModels(provider)
    .then((response) => {
      const catalogue: Catalogue = new Map(
        response.models.map((model) => [model.id, model.pricing]),
      )
      loaded.set(provider, catalogue)
      return catalogue
    })
    .catch(() => {
      // No catalogue means no price, which callers already handle by saying
      // nothing. Not worth failing a screen over.
      const empty: Catalogue = new Map()
      loaded.set(provider, empty)
      return empty
    })
    .finally(() => {
      inFlight.delete(provider)
    })

  inFlight.set(provider, request)
  return request
}

export async function pricingFor(
  provider: TtsProvider,
  model: string,
): Promise<TtsPricing | null> {
  const catalogue = loaded.get(provider) ?? (await fetchCatalogue(provider))
  return catalogue.get(model) ?? null
}

/** Drops the memo, so a saved API key takes effect without a reload. */
export function forgetPricing(provider?: TtsProvider): void {
  if (provider) {
    loaded.delete(provider)
    return
  }
  loaded.clear()
}
