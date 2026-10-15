import { api } from './api'

export type ExchangeRateEntry = {
  currency: string
  country: string
  denomination: number
  rateType: string
  sourceRate: string
  sourceUnit: number
  rateToTHB: string
  inverseRate: string
  effectiveDate: string
  effectiveTime: string
  source: string
}

export function bangkokToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date())
}

export function normalizeCurrencyCode(code: string): string {
  return code.replace(/\*+$/, '')
}

const cache = new Map<string, Promise<ExchangeRateEntry[]>>()

export function fetchExchangeRates(date: string): Promise<ExchangeRateEntry[]> {
  const cached = cache.get(date)
  if (cached) return cached

  const promise = api.listExchangeRates(date) as Promise<ExchangeRateEntry[]>
  cache.set(date, promise)
  promise.catch(() => cache.delete(date))
  return promise
}

export type ResolvedRate = {
  rate: number
  rawRate: number
  entry: ExchangeRateEntry
}


export const DEFAULT_CURRENCY_BUFFER = 5.5

export function applyCurrencyBuffer(rawRate: number, bufferPercent = DEFAULT_CURRENCY_BUFFER): number {
  const buffered = rawRate * (1 + bufferPercent / 100)
  const decimals = buffered >= 1 ? 1 : 4
  const factor = 10 ** decimals
  return Math.round(buffered * factor) / factor
}

export function resolveRate(
  entries: ExchangeRateEntry[],
  currencyCode: string,
  bufferPercent = DEFAULT_CURRENCY_BUFFER,
): ResolvedRate | null {
  const target = normalizeCurrencyCode(currencyCode)
  const entry = entries.find((e) => normalizeCurrencyCode(e.currency) === target)
  if (!entry) return null

  const rawRate = Number(entry.rateToTHB)
  if (!Number.isFinite(rawRate) || rawRate <= 0) return null

  return { rate: applyCurrencyBuffer(rawRate, bufferPercent), rawRate, entry }
}

