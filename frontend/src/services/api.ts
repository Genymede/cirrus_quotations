export type ApiMode = 'legacy' | 'ems'

export type Company = {
  id: string
  name: string
  code: string
  isActive: boolean
}

export const API_MODE: ApiMode =
  (import.meta.env.VITE_API_MODE as string | undefined) === 'ems' ? 'ems' : 'legacy'

// claude_prompt.txt (EMS hardening): the matching env var wins when set.
// When it isn't, default to the HOSTNAME this page was itself loaded from
// (not a hardcoded "localhost"), so a browser opened from another machine
// on the LAN calls that same host's backend/SSO target instead of trying
// to reach "localhost" on the viewer's own machine. On the dev machine
// itself (localhost in the address bar) this is byte-identical to the old
// hardcoded defaults. `typeof window === 'undefined'` guard matches this
// file's own existing style (see consumeSsoFragmentToken below).
function currentOriginBase(port: number): string {
  if (typeof window === 'undefined') return `http://localhost:${port}`
  return `${window.location.protocol}//${window.location.hostname}:${port}`
}

const LEGACY_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) || `${currentOriginBase(4500)}/api/inventory`

const EMS_ROOT = (import.meta.env.VITE_EMS_API_URL as string | undefined) || currentOriginBase(3000)
const EMS_BASE = `${EMS_ROOT}/api/v1/ems`

export const EMS_FRONTEND_URL =
  (import.meta.env.VITE_EMS_FRONTEND_URL as string | undefined) || currentOriginBase(5174)

const TOKEN_KEY = 'qt_ems_token'

function readStoredToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

function consumeSsoFragmentToken(): string | null {
  if (typeof window === 'undefined') return null

  const hash = window.location.hash
  if (!hash.startsWith('#sso=')) return null

  window.history.replaceState(null, '', window.location.pathname + window.location.search)

  const raw = hash.slice('#sso='.length)
  return raw ? decodeURIComponent(raw) : null
}

const ssoToken = API_MODE === 'ems' ? consumeSsoFragmentToken() : null

let token: string | null = ssoToken ?? (API_MODE === 'ems' ? readStoredToken() : null)

if (ssoToken) {
  try {
    sessionStorage.setItem(TOKEN_KEY, ssoToken)
  } catch {
    // sessionStorage unavailable (private mode, etc.) -- the in-memory
    // token still works for the rest of this tab's session.
  }
}

export function getToken(): string | null {
  return token
}

export function setToken(next: string | null): void {
  token = next
  try {
    if (next) sessionStorage.setItem(TOKEN_KEY, next)
    else sessionStorage.removeItem(TOKEN_KEY)
  } catch {
    // sessionStorage unavailable (private mode, etc.) -- the in-memory
    // token still works for the rest of this tab's session.
  }
}

let unauthorizedHandler: (() => void) | null = null
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  unauthorizedHandler = fn
}

function authHeaders(): Record<string, string> {
  if (API_MODE !== 'ems' || !token) return {}
  return { Authorization: `Bearer ${token}` }
}

type ErrorBody = { error?: string; message?: string | string[] }

async function readableError(response: Response): Promise<string> {
  let body: ErrorBody | null = null

  try {
    body = await response.json()
  } catch {
    // no JSON body -- fall through to the status-based messages below
  }

  if (body?.message) {
    return Array.isArray(body.message) ? body.message.join('; ') : body.message
  }

  if (body?.error) return body.error

  if (response.status === 401) return 'Your session has expired — please log in again.'
  if (response.status === 403) return 'You do not have permission to do this.'

  return `Request failed (${response.status})`
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response

  try {
    response = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
        ...init?.headers,
      },
    })
  } catch {
    throw new Error('Network error — check your connection and try again.')
  }

  if (!response.ok) {
    const message = await readableError(response)

    if (response.status === 401 && API_MODE === 'ems') {
      setToken(null)
      unauthorizedHandler?.()
    }

    throw new Error(message)
  }

  if (response.status === 204) return undefined as T

  return (await response.json()) as T
}

function quotationsUrl(suffix = ''): string {
  return API_MODE === 'ems' ? `${EMS_BASE}/sales/quotations${suffix}` : `${LEGACY_BASE}/quotations${suffix}`
}

function itemsUrl(suffix = ''): string {
  return API_MODE === 'ems' ? `${EMS_BASE}/sales/quotations/items${suffix}` : `${LEGACY_BASE}/items${suffix}`
}

function clientsUrl(): string {
  return `${EMS_BASE}/sales/quotations/clients`
}

function companiesUrl(): string {
  return `${EMS_BASE}/inventory/companies`
}

function unitsUrl(): string {
  return API_MODE === 'ems' ? `${EMS_BASE}/inventory/units` : `${LEGACY_BASE}/units`
}

function projectsUrl(): string {
  return API_MODE === 'ems' ? `${EMS_BASE}/projects` : `${LEGACY_BASE}/quotations/projects`
}

function exchangeRateUrl(date: string): string {
  return `${EMS_BASE}/exchange-rate?date=${encodeURIComponent(date)}`
}

export type LoginResult = {
  accessToken: string
  user?: { id: string; name?: string; email?: string }
}

// Cost & Profit report (claude_prompt.txt) -- mirrors
// ems-backend's cost-profit-calculator.ts output shape exactly.
export type CostProfitTotals = {
  revenueExVat: number
  revenueCosted: number
  costQuoted: number
  costBank: number
  profitQuoted: number
  profitBank: number
  bufferGain: number
  linesWithoutCost: number
  // claude_prompt.txt ("Cost & Profit report adjustments"): import tax is a
  // pass-through, excluded from every other total above.
  passThroughImportTax: number
}
export type CostProfitLine = {
  kind: 'part' | 'stock' | 'shipping' | 'import_tax' | 'ctl' | 'discount'
  name: string
  qty: number
  unit: string | null
  unitCostFc: number | null
  markupPercent: number | null
  unitPriceIncVat: number | null
  revenueExVat: number
  costQuoted: number | null
  costBank: number | null
  costKnown: boolean
  passThrough?: boolean
}
export type CostProfitGroup = {
  kind: 'external' | 'stock' | 'other'
  groupId: string | null
  sourceName: string
  country: string | null
  sourceType: string | null
  currency: string | null
  exchangeRate: number | null
  actualExchangeRate: number | null
  bufferPercent: number | null
  exchangeRateDate: string | null
  bankRateMissing: boolean
  lines: CostProfitLine[]
}
// claude_prompt.txt ("Cost & Profit report display improvements"): null
// when there is no discount on this quotation.
export type CostProfitDiscount = { amountIncVat: number; percentOfPartsSubtotal: number } | null

export type CostProfitQuotation = {
  id: string
  number: string
  status: 'accepted' | 'sent'
  statusDate: string
  statusDateEstimated: boolean
  totals: CostProfitTotals
  reconcile: { headerTotal: number; computedIncVat: number; diff: number }
  discount: CostProfitDiscount
  groups: CostProfitGroup[]
}
export type CostProfitProject = {
  projectId: string | null
  name: string
  clientName: string
  totals: CostProfitTotals
  quotations: CostProfitQuotation[]
}
export type CostProfitReport = {
  month: string
  statuses: ('accepted' | 'sent')[]
  totals: CostProfitTotals
  projects: CostProfitProject[]
}

export const api = {
  mode: API_MODE,

  listQuotations: (): Promise<unknown[]> => request(quotationsUrl()),

  getQuotation: (id: string): Promise<unknown> => request(quotationsUrl(`/${id}`)),

  createQuotation: (payload: unknown): Promise<{ id: string; number: string; status: string }> =>
    request(quotationsUrl(), { method: 'POST', body: JSON.stringify(payload) }),

  updateQuotation: (id: string, payload: unknown): Promise<{ id: string; number: string; status: string }> =>
    request(quotationsUrl(`/${id}`), { method: 'PUT', body: JSON.stringify(payload) }),

  updateQuotationStatus: (id: string, status: string): Promise<{ quotation: { status: string } }> =>
    request(quotationsUrl(`/${id}/status`), { method: 'PATCH', body: JSON.stringify({ status }) }),

  listItems: (): Promise<unknown[]> => request(itemsUrl()),

  getItem: (id: string): Promise<unknown> => request(itemsUrl(`/${id}`)),

  listUnits: (): Promise<unknown[]> => request(unitsUrl()),

  listProjects: (): Promise<unknown[]> => request(projectsUrl()),

  listClients: (): Promise<unknown[]> => request(clientsUrl()),
  listCompanies: (): Promise<Company[]> => request(companiesUrl()),

  listExchangeRates: (date: string): Promise<unknown[]> => request(exchangeRateUrl(date)),

  login: (email: string, password: string): Promise<LoginResult> =>
    request(`${EMS_BASE}/auth/login`, { method: 'POST', body: JSON.stringify({ email, password }) }),

  getCostProfit: (month: string, statuses: ('accepted' | 'sent')[]): Promise<CostProfitReport> =>
    request(`${EMS_BASE}/sales/reports/cost-profit?month=${encodeURIComponent(month)}&statuses=${statuses.join(',')}`),
}
