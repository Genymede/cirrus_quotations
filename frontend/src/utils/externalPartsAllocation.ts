import { roundMoney } from './money'
export const VAT_RATE = 0.07
export type SourceType = 'import' | 'local_supplier' | 'local_purchase'
export type DeliveryUnit = 'days' | 'weeks' | 'months' | 'years'
export type CurrencyCode =
  | 'THB'
  | 'USD'
  | 'EUR'
  | 'GBP'
  | 'JPY'
  | 'SGD'
  | 'HKD'
  | 'BND'
  | 'AUD'
  | 'CAD'
  | 'CHF'
  | 'CNY'
  | 'KRW'
  | 'NZD'
  | 'SAR'
  | 'TWD'
  | 'ZAR'
  | 'AED'
export type ExternalPart = {
  id: string
  partName: string
  qty: number
  unit: string
  unitCost: number
  markupPercent: number
  unitPrice: number
  unitWeight: number
  hasStockPortion: boolean
  stockQty: number
  unitCostTHB: number
  importTaxPercent: number
  importTaxAmount: number
}
export type ExternalGroup = {
  id: string
  sourceType: SourceType
  sourceName: string
  brand: string
  country: string
  parts: ExternalPart[]
  shippingCost: number
  importTax: number
  estimatedDelivery: string
  warranty: string
  installationIncluded: boolean
  containsStockItems: boolean
  currency: CurrencyCode
  exchangeRate: number
  actualExchangeRate?: number | null   // เพิ่ม: เรตดิบก่อนบวก buffer
  exchangeRateDate: string | null
  shippingCostFc: number | null
  importTaxPercent: number | null
  transferFee: number | null
  bufferPercent?: number
}
export function calculateSellingPrice(
  unitCostTHB: number,
  markupPercent: number,
  currency: CurrencyCode
): number {
  const cost = Number(unitCostTHB) || 0
  const markup = Number(markupPercent) || 0
  const priceBeforeVat = cost * (1 + markup / 100)
  const priceWithVat = priceBeforeVat * (1 + VAT_RATE)
  const priceCents = Math.round(priceWithVat * 100)
  const roundToCents = (currency === 'THB' ? 1 : 10) * 100
  return (Math.ceil(priceCents / roundToCents) * roundToCents) / 100
}
export function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).substring(2, 10)}`
}
function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100
}
export type CurrencyConfig = {
  code: CurrencyCode
  name: string
  symbol: string
  defaultTransferFee: number // THB
  shippingRoundingStep: number // THB
}

export const CURRENCY_CONFIG: Record<CurrencyCode, CurrencyConfig> = {
  THB: { code: 'THB', name: 'Thai Baht', symbol: '฿', defaultTransferFee: 0, shippingRoundingStep: 1 },
  USD: { code: 'USD', name: 'US Dollar', symbol: '$', defaultTransferFee: 1350, shippingRoundingStep: 10 },
  EUR: { code: 'EUR', name: 'Euro', symbol: '€', defaultTransferFee: 1750, shippingRoundingStep: 10 },
  GBP: { code: 'GBP', name: 'British Pound', symbol: '£', defaultTransferFee: 1350, shippingRoundingStep: 10 },
  JPY: { code: 'JPY', name: 'Japanese Yen', symbol: '¥', defaultTransferFee: 1350, shippingRoundingStep: 10 },
  SGD: { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$', defaultTransferFee: 1350, shippingRoundingStep: 10 },
  HKD: { code: 'HKD', name: 'Hong Kong Dollar', symbol: 'HK$', defaultTransferFee: 1350, shippingRoundingStep: 10 },
  BND: { code: 'BND', name: 'Brunei Dollar', symbol: 'B$', defaultTransferFee: 1350, shippingRoundingStep: 10 },
  AUD: { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', defaultTransferFee: 1350, shippingRoundingStep: 10 },
  CAD: { code: 'CAD', name: 'Canadian Dollar', symbol: 'CA$', defaultTransferFee: 1350, shippingRoundingStep: 10 },
  CHF: { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF', defaultTransferFee: 1350, shippingRoundingStep: 10 },
  CNY: { code: 'CNY', name: 'Chinese Yuan', symbol: '¥', defaultTransferFee: 1350, shippingRoundingStep: 10 },
  KRW: { code: 'KRW', name: 'South Korean Won', symbol: '₩', defaultTransferFee: 1350, shippingRoundingStep: 10 },
  NZD: { code: 'NZD', name: 'New Zealand Dollar', symbol: 'NZ$', defaultTransferFee: 1350, shippingRoundingStep: 10 },
  SAR: { code: 'SAR', name: 'Saudi Riyal', symbol: 'SAR', defaultTransferFee: 1350, shippingRoundingStep: 10 },
  TWD: { code: 'TWD', name: 'Taiwan Dollar', symbol: 'NT$', defaultTransferFee: 1350, shippingRoundingStep: 10 },
  ZAR: { code: 'ZAR', name: 'South African Rand', symbol: 'R', defaultTransferFee: 1350, shippingRoundingStep: 10 },
  AED: { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ', defaultTransferFee: 1350, shippingRoundingStep: 10 },
}

export function defaultTransferFee(currency: CurrencyCode): number {
  return CURRENCY_CONFIG[currency].defaultTransferFee
}
// claude_prompt.txt ("shipping price rule B"): two customer-shipping
// pricing rules for a new-style lot (shippingCostFc not null) --
//   A (old): ROUNDUP(shipping_cost * 1.07 + transfer_fee, step)   -- fee added AFTER VAT
//   B (new): ROUNDUP((shipping_cost + transfer_fee) * 1.07, step) -- fee added BEFORE VAT
// Every existing quotation was saved under A; new quotations use B. Which
// rule applies to an already-saved quotation is decided per quotation by
// detectShippingRule() below (matching the stored header shipping total),
// never by which lot/group happens to be open -- callers must pass the
// rule explicitly, there is no default.
export type ShippingRule = 'A' | 'B'

export type LotShippingInput = {
  shippingCostFc: number | null | undefined
  rate: number
  currency: CurrencyCode
  transferFee?: number | null
  rule: ShippingRule
}
export type LotShippingResult = {
  shippingThb: number
  customerShipping: number
  transferFeeApplied: number | null
}
export function lotShipping(input: LotShippingInput): LotShippingResult {
  const fc = Number(input.shippingCostFc) || 0
  if (!(fc > 0)) {
    return { shippingThb: 0, customerShipping: 0, transferFeeApplied: null }
  }
  const rate = Number(input.rate) || 0
  const shippingThb = round2(fc * rate)
  const config = CURRENCY_CONFIG[input.currency]
  const transferFeeApplied = round2(
    input.transferFee != null ? input.transferFee : config.defaultTransferFee
  )
  const preStepCents = input.rule === 'A'
    ? Math.round((shippingThb * (1 + VAT_RATE) + transferFeeApplied) * 100)
    : Math.round((shippingThb + transferFeeApplied) * (1 + VAT_RATE) * 100)
  const stepCents = config.shippingRoundingStep * 100
  const customerShipping = (Math.ceil(preStepCents / stepCents) * stepCents) / 100
  return { shippingThb, customerShipping, transferFeeApplied }
}
export type LotImportTaxInput = {
  percent: number | null | undefined
  sourceType: SourceType
  lineTotalsThb: number[]
}
export type LotImportTaxResult = {
  amount: number
}
export function lotImportTax(input: LotImportTaxInput): LotImportTaxResult {
  if (input.sourceType !== 'import') return { amount: 0 }
  const percent = Number(input.percent) || 0
  if (!(percent > 0)) return { amount: 0 }
  const base = input.lineTotalsThb.reduce((sum, v) => sum + (Number(v) || 0), 0)
  return { amount: round2(base * (percent / 100)) }
}
export function totalBoxWeight(parts: ExternalPart[]): number {
  return parts.reduce((sum, part) => sum + part.qty * part.unitWeight, 0)
}
export function totalStockWeight(group: Pick<ExternalGroup, 'parts' | 'containsStockItems'>): number {
  if (!group.containsStockItems) return 0
  return group.parts.reduce((sum, part) => sum + (part.hasStockPortion ? part.stockQty * part.unitWeight : 0), 0)
}
export function stockWeightRatio(stockWeight: number, boxWeight: number): number {
  return boxWeight > 0 ? stockWeight / boxWeight : 0
}
export type MoneySplit = { stockPortion: number; customerPortion: number }
export function splitByRatio(total: number, ratio: number): MoneySplit {
  const stockPortion = roundMoney(total * ratio)
  const customerPortion = roundMoney(total - stockPortion)
  return { stockPortion, customerPortion }
}
export type ShippingAllocation = {
  totalWeight: number
  stockWeight: number
  ratio: number
  shippingVat: number
  stock: { shippingBeforeVat: number; vat: number; total: number }
  customer: { shippingBeforeVat: number; vat: number; total: number }
}
function customerShippingBeforeVat(group: Pick<ExternalGroup, 'parts' | 'shippingCost' | 'containsStockItems'>): number {
  const boxWeight = totalBoxWeight(group.parts)
  const stockWeight = totalStockWeight(group)
  const ratio = group.containsStockItems ? stockWeightRatio(stockWeight, boxWeight) : 0
  return splitByRatio(group.shippingCost, ratio).customerPortion
}
export function computeShippingAllocation(
  group: Pick<ExternalGroup, 'parts' | 'shippingCost' | 'containsStockItems'>,
  vatRate: number = VAT_RATE,
): ShippingAllocation {
  const boxWeight = totalBoxWeight(group.parts)
  const stockWeight = totalStockWeight(group)
  const ratio = group.containsStockItems ? stockWeightRatio(stockWeight, boxWeight) : 0
  const shippingVat = roundMoney(group.shippingCost * vatRate)
  const shippingSplit = splitByRatio(group.shippingCost, ratio)
  const vatSplit = splitByRatio(shippingVat, ratio)
  return {
    totalWeight: boxWeight,
    stockWeight,
    ratio,
    shippingVat,
    stock: {
      shippingBeforeVat: shippingSplit.stockPortion,
      vat: vatSplit.stockPortion,
      total: roundMoney(shippingSplit.stockPortion + vatSplit.stockPortion),
    },
    customer: {
      shippingBeforeVat: shippingSplit.customerPortion,
      vat: vatSplit.customerPortion,
      total: roundMoney(shippingSplit.customerPortion + vatSplit.customerPortion),
    },
  }
}
export function customerShippingForQuotation(
  group: Pick<ExternalGroup, 'parts' | 'shippingCost' | 'containsStockItems' | 'shippingCostFc' | 'currency' | 'exchangeRate' | 'transferFee'>,
  rule: ShippingRule,
  vatRate: number = VAT_RATE,
): number {
  if (group.shippingCostFc != null) {
    const lot = lotShipping({
      shippingCostFc: group.shippingCostFc,
      rate: group.exchangeRate,
      currency: group.currency,
      transferFee: group.transferFee,
      rule,
    })
    const boxWeight = totalBoxWeight(group.parts)
    const stockWeight = totalStockWeight(group)
    const ratio = group.containsStockItems ? stockWeightRatio(stockWeight, boxWeight) : 0
    return splitByRatio(lot.customerShipping, ratio).customerPortion
  }
  // Legacy group (no shippingCostFc): same formula regardless of rule, per
  // the task's own instruction to leave it untouched.
  return roundMoney(customerShippingBeforeVat(group) * (1 + vatRate))
}

// Per-quotation rule detection: sum every group's shipping under A and
// under B (legacy groups contribute the same amount to both sums), compare
// each sum against the quotation's stored header shipping total within a
// 0.005 tolerance. Both match (e.g. no shipping, or zero transfer fee) ->
// B. Only one matches -> that one. Neither matches -> A, and the mismatch
// is left to surface through whatever reconcile/"total differs" check the
// caller already has (no separate flag here).
const SHIPPING_RULE_TOLERANCE = 0.005

export function detectShippingRule(
  groups: Pick<ExternalGroup, 'parts' | 'shippingCost' | 'containsStockItems' | 'shippingCostFc' | 'currency' | 'exchangeRate' | 'transferFee'>[],
  storedShippingTotal: number,
): ShippingRule {
  const sumFor = (rule: ShippingRule) =>
    roundMoney(groups.reduce((sum, g) => sum + customerShippingForQuotation(g, rule), 0))
  const sumA = sumFor('A')
  const sumB = sumFor('B')
  const bMatches = Math.abs(sumB - storedShippingTotal) <= SHIPPING_RULE_TOLERANCE
  const aMatches = Math.abs(sumA - storedShippingTotal) <= SHIPPING_RULE_TOLERANCE
  if (bMatches) return 'B'
  if (aMatches) return 'A'
  return 'A'
}
export function shouldShowShippingLine(group: Pick<ExternalGroup, 'parts'>): boolean {
  return getQuotationParts(group.parts).length > 0
}
export function shippingLineLabel(group: Pick<ExternalGroup, 'brand' | 'sourceName'>): string {
  const brand = group.brand.trim() || group.sourceName.trim()
  return `Estimated Shipping Cost (From ${brand})`
}
export function importTaxForQuotation(group: Pick<ExternalGroup, 'importTax' | 'parts'>): number {
  if (getQuotationParts(group.parts).length === 0) return 0
  return group.importTax
}
export function quotationQty(part: Pick<ExternalPart, 'qty' | 'stockQty' | 'hasStockPortion'>): number {
  if (!part.hasStockPortion) return part.qty
  return part.qty - part.stockQty
}
export function isExcludedFromQuotation(part: Pick<ExternalPart, 'qty' | 'stockQty' | 'hasStockPortion'>): boolean {
  return part.hasStockPortion && part.stockQty >= part.qty
}
export type QuotationPart = ExternalPart & { quotationQty: number }
export function getQuotationParts(parts: ExternalPart[]): QuotationPart[] {
  return parts
    .filter((part) => !isExcludedFromQuotation(part))
    .map((part) => ({ ...part, quotationQty: quotationQty(part) }))
}
export function quotationPartsSubtotal(parts: ExternalPart[]): number {
  return getQuotationParts(parts).reduce((sum, part) => sum + part.quotationQty * part.unitPrice, 0)
}
export type ValidationError = {
  partId?: string
  field: 'unitWeight' | 'stockQty'
  message: string
}
export function validateExternalGroup(group: ExternalGroup): ValidationError[] {
  const errors: ValidationError[] = []
  if (!group.containsStockItems) return errors
  for (const part of group.parts) {
    const label = part.partName.trim() || 'This part'
    if (!(part.unitWeight > 0)) {
      errors.push({ partId: part.id, field: 'unitWeight', message: `${label}: Unit Weight must be greater than 0` })
    }
    if (part.hasStockPortion && !(part.stockQty > 0 && part.stockQty <= part.qty)) {
      errors.push({
        partId: part.id,
        field: 'stockQty',
        message: `${label}: Stock Qty must be greater than 0 and no more than Qty (${part.qty})`,
      })
    }
  }
  return errors
}
export function isExternalGroupValid(group: ExternalGroup): boolean {
  return validateExternalGroup(group).length === 0
}
export function createEmptyExternalPart(
  overrides?: Partial<ExternalPart>
): ExternalPart {
  return {
    id: createId(),
    partName: '',
    qty: 1,
    unit: '',
    unitCost: 0,
    unitCostTHB: 0,
    markupPercent: 0,
    unitPrice: 0,
    unitWeight: 0,
    hasStockPortion: false,
    stockQty: 0,
    importTaxPercent: 0,
    importTaxAmount: 0,
    ...overrides,
  }
}
export function clearStockAllocation(parts: ExternalPart[]): ExternalPart[] {
  return parts.map((part) => ({ ...part, unitWeight: 0, hasStockPortion: false, stockQty: 0 }))
}
