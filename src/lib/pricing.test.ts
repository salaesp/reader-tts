import { describe, expect, it } from 'vitest'
import { describePricing, formatPricePerMillion } from '../../shared/types'

describe('formatPricePerMillion', () => {
  // Per-token prices are unreadable at their natural scale.
  it('scales a per-token price to per million', () => {
    expect(formatPricePerMillion(0.000015)).toBe('$15')
    expect(formatPricePerMillion(0.00002)).toBe('$20')
    expect(formatPricePerMillion(0.0000125)).toBe('$12.5')
  })

  it('keeps very small prices legible instead of rounding them to zero', () => {
    expect(formatPricePerMillion(0.000000001)).toBe('$0.0010')
  })

  it('reports a genuine zero as zero', () => {
    expect(formatPricePerMillion(0)).toBe('0')
  })
})

describe('describePricing', () => {
  // The bug this replaced: reading `completion` (always "0" for speech) made
  // every paid model read as free.
  it('prices a model on what it charges for the text sent', () => {
    expect(describePricing({ input: 0.000015, output: 0 }, 'free')).toBe('$15/M')
  })

  it('calls a model free only when nothing is charged', () => {
    expect(describePricing({ input: 0, output: 0 }, 'free')).toBe('free')
  })

  it('mentions output only when a provider actually bills it', () => {
    expect(describePricing({ input: 0.00001, output: 0.00003 }, 'free')).toBe('$10/M +$30/M out')
    expect(describePricing({ input: 0, output: 0.00003 }, 'free')).toBe('+$30/M out')
  })

  it('says nothing when no price is published', () => {
    expect(describePricing(null, 'free')).toBeNull()
    expect(describePricing({ input: null, output: null }, 'free')).toBeNull()
  })
})

describe('describePricing with a shape it does not recognise', () => {
  // The field was a string before it was an object. A client holding a cached
  // response from then destructured undefined out of it and concluded "free" —
  // turning missing information into a claim about money.
  it('says nothing rather than free', () => {
    expect(describePricing('0.00002' as unknown, 'free')).toBeNull()
    expect(describePricing('0' as unknown, 'free')).toBeNull()
    expect(describePricing(0 as unknown, 'free')).toBeNull()
    expect(describePricing(undefined as unknown, 'free')).toBeNull()
    expect(describePricing({} as unknown, 'free')).toBeNull()
    expect(describePricing({ input: 'free' } as unknown, 'free')).toBeNull()
    expect(describePricing({ input: NaN } as unknown, 'free')).toBeNull()
  })

  it('still reads a well-formed price', () => {
    expect(describePricing({ input: 0.000015, output: 0 }, 'free')).toBe('$15/M')
  })
})
