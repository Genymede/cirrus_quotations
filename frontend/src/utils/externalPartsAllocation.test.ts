import { describe, it, expect } from 'vitest'
import { lotShipping, customerShippingForQuotation, detectShippingRule, type ExternalGroup } from './externalPartsAllocation'

function round2(n: number) {
  return Math.round(n * 100) / 100
}

function baseGroup(overrides: Partial<ExternalGroup> = {}): ExternalGroup {
  return {
    id: 'g1',
    sourceType: 'import',
    sourceName: 'Supplier',
    brand: '',
    country: '',
    parts: [],
    shippingCost: 0,
    importTax: 0,
    estimatedDelivery: '',
    warranty: '',
    installationIncluded: false,
    containsStockItems: false,
    currency: 'USD',
    exchangeRate: 1,
    exchangeRateDate: null,
    shippingCostFc: null,
    importTaxPercent: null,
    transferFee: null,
    ...overrides,
  }
}

// claude_prompt.txt ("shipping price rule B"): the task's own vector table,
// rule A (old, unchanged) vs rule B (new).
describe('lotShipping: rule A vs rule B', () => {
  it('USD, fc 20 @ 33.5, fee 1,350 (shipping_cost 670.00) -> A 2,070 / B 2,170', () => {
    const a = lotShipping({ shippingCostFc: 20, rate: 33.5, currency: 'USD', transferFee: 1350, rule: 'A' })
    const b = lotShipping({ shippingCostFc: 20, rate: 33.5, currency: 'USD', transferFee: 1350, rule: 'B' })
    expect(a.customerShipping).toBe(2070)
    expect(b.customerShipping).toBe(2170)
  })

  it('EUR, fc 10 @ 39.4, fee 1,750 (394.00) -> A 2,180 / B 2,300', () => {
    const a = lotShipping({ shippingCostFc: 10, rate: 39.4, currency: 'EUR', transferFee: 1750, rule: 'A' })
    const b = lotShipping({ shippingCostFc: 10, rate: 39.4, currency: 'EUR', transferFee: 1750, rule: 'B' })
    expect(a.customerShipping).toBe(2180)
    expect(b.customerShipping).toBe(2300)
  })

  it('THB, shipping 500, fee 0 -> A 535 / B 535', () => {
    const a = lotShipping({ shippingCostFc: 500, rate: 1, currency: 'THB', transferFee: 0, rule: 'A' })
    const b = lotShipping({ shippingCostFc: 500, rate: 1, currency: 'THB', transferFee: 0, rule: 'B' })
    expect(a.customerShipping).toBe(535)
    expect(b.customerShipping).toBe(535)
  })

  it('EUR, fc 125 @ 38.2103, fee 1,750 (4,776.29) -> A 6,870 / B 6,990', () => {
    const a = lotShipping({ shippingCostFc: 125, rate: 38.2103, currency: 'EUR', transferFee: 1750, rule: 'A' })
    const b = lotShipping({ shippingCostFc: 125, rate: 38.2103, currency: 'EUR', transferFee: 1750, rule: 'B' })
    expect(a.customerShipping).toBe(6870)
    expect(b.customerShipping).toBe(6990)
  })

  it('SGD, fc 150 @ 28.1514, fee 1,350 (4,222.71) -> A 5,870 / B 5,970', () => {
    const a = lotShipping({ shippingCostFc: 150, rate: 28.1514, currency: 'SGD', transferFee: 1350, rule: 'A' })
    const b = lotShipping({ shippingCostFc: 150, rate: 28.1514, currency: 'SGD', transferFee: 1350, rule: 'B' })
    expect(a.customerShipping).toBe(5870)
    expect(b.customerShipping).toBe(5970)
  })

  it('SGD, fc 550 @ 28, fee 1,350 (15,400.00) -> A 17,830 / B 17,930', () => {
    const a = lotShipping({ shippingCostFc: 550, rate: 28, currency: 'SGD', transferFee: 1350, rule: 'A' })
    const b = lotShipping({ shippingCostFc: 550, rate: 28, currency: 'SGD', transferFee: 1350, rule: 'B' })
    expect(a.customerShipping).toBe(17830)
    expect(b.customerShipping).toBe(17930)
  })

  it('no shipping -> 0 under both rules, no fee applied', () => {
    const a = lotShipping({ shippingCostFc: 0, rate: 33.5, currency: 'USD', transferFee: null, rule: 'A' })
    const b = lotShipping({ shippingCostFc: 0, rate: 33.5, currency: 'USD', transferFee: null, rule: 'B' })
    expect(a.customerShipping).toBe(0)
    expect(b.customerShipping).toBe(0)
    expect(a.transferFeeApplied).toBe(null)
  })

  it('exact multiple: shipping_cost 650.00 + fee 1,350 -> B stays 2,140, not 2,150', () => {
    // shipping_cost 650 = fc 650 @ rate 1 (THB-equivalent arithmetic, any currency/rate combo giving 650 works)
    const b = lotShipping({ shippingCostFc: 650, rate: 1, currency: 'USD', transferFee: 1350, rule: 'B' })
    expect(b.customerShipping).toBe(2140)
  })
})

describe('customerShippingForQuotation: real-data lots, rule B profit check', () => {
  it('EUR 125 lot: B customer amount 6,990 -> revenue 6,532.71', () => {
    const group = baseGroup({ currency: 'EUR', exchangeRate: 38.2103, shippingCostFc: 125, shippingCost: round2(125 * 38.2103), transferFee: 1750 })
    const amount = customerShippingForQuotation(group, 'B')
    expect(amount).toBe(6990)
    expect(round2(amount / 1.07)).toBe(6532.71)
  })

  it('SGD 150 lot: B customer amount 5,970 -> revenue 5,579.44', () => {
    const group = baseGroup({ currency: 'SGD', exchangeRate: 28.1514, shippingCostFc: 150, shippingCost: round2(150 * 28.1514), transferFee: 1350 })
    const amount = customerShippingForQuotation(group, 'B')
    expect(amount).toBe(5970)
    expect(round2(amount / 1.07)).toBe(5579.44)
  })

  // claude_prompt.txt states two different numbers for this same lot: Part
  // 1a's vector table gives customer amount 17,930 (16,750*1.07=17,922.50,
  // rounded up -- matches our own worked check exactly); Part 1b's
  // real-data-lots line states revenue 16,757.94 / profit +7.94. But
  // 17,930 / 1.07 = 16,757.01 (verified: 1793000/107 by long division), not
  // 16,757.94 -- the two task figures are mutually inconsistent. We trust
  // Part 1a's own worked arithmetic (it shows its work and checks out) and
  // treat Part 1b's 16,757.94/+7.94 as a transcription slip in the task
  // text, not something to force our code to match. Flagged in the report.
  it('SGD 550 lot: B customer amount 17,930 -> revenue 16,757.01 (see note on the task\'s inconsistent figures)', () => {
    const group = baseGroup({ currency: 'SGD', exchangeRate: 28, shippingCostFc: 550, shippingCost: round2(550 * 28), transferFee: 1350 })
    const amount = customerShippingForQuotation(group, 'B')
    expect(amount).toBe(17930)
    expect(round2(amount / 1.07)).toBe(16757.01)
    expect(round2(round2(amount / 1.07) - 16750)).toBe(7.01)
  })
})

describe('detectShippingRule', () => {
  it('picks A for a quotation saved under the old rule', () => {
    const group = baseGroup({ currency: 'USD', exchangeRate: 33.5, shippingCostFc: 20, shippingCost: 670, transferFee: 1350 })
    const rule = detectShippingRule([group], 2070) // rule-A total
    expect(rule).toBe('A')
  })

  it('picks B for a quotation saved under the new rule', () => {
    const group = baseGroup({ currency: 'USD', exchangeRate: 33.5, shippingCostFc: 20, shippingCost: 670, transferFee: 1350 })
    const rule = detectShippingRule([group], 2170) // rule-B total
    expect(rule).toBe('B')
  })

  it('picks B when both rules produce the same total (e.g. no shipping)', () => {
    const group = baseGroup({ currency: 'USD', exchangeRate: 33.5, shippingCostFc: null, shippingCost: 0, transferFee: null })
    const rule = detectShippingRule([group], 0)
    expect(rule).toBe('B')
  })

  it('falls back to A and leaves the mismatch for the caller to flag when neither matches', () => {
    const group = baseGroup({ currency: 'USD', exchangeRate: 33.5, shippingCostFc: 20, shippingCost: 670, transferFee: 1350 })
    const rule = detectShippingRule([group], 9999.99) // matches neither
    expect(rule).toBe('A')
  })

  it('legacy groups (no shippingCostFc) are rule-agnostic and never block detection', () => {
    const legacy = baseGroup({ currency: 'USD', shippingCostFc: null, shippingCost: 1000, containsStockItems: false })
    // Legacy-only quotation: same total either way -> treated as B (both match)
    const storedTotal = round2(1000 * 1.07)
    expect(detectShippingRule([legacy], storedTotal)).toBe('B')
  })
})
