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

// claude_prompt.txt ("SSO: opening a direct link to another app asks for
// login again"): sessionStorage (used above) is per-tab even within the
// same origin -- a direct/bookmarked/pasted visit, or a plain new tab,
// never has it, fragment or not. Callers (App.tsx, CostAndProfitPage.tsx)
// call this once on boot when getToken() is still null: it asks
// ems-backend's GET /auth/sso whether the browser holds a valid shared
// session cookie (verified server-side there, never trusted client-side
// here), and on success stores the SAME real access token this file's
// normal login path already stores, through the exact same setToken() --
// no new token format, no new login method. Resolves to whether it found
// one; never throws.
export async function attemptSsoHydrate(): Promise<boolean> {
  if (API_MODE !== 'ems' || token) return !!token
  try {
    const response = await fetch(`${EMS_BASE}/auth/sso`, { credentials: 'include' })
    if (!response.ok) return false
    const result = (await response.json()) as LoginResult
    setToken(result.accessToken)
    return true
  } catch {
    return false
  }
}

// claude_prompt.txt (this round): logout must also clear the shared
// cookie server-side -- otherwise the next direct visit here (or to any
// other app sharing this login) would silently sign back in via
// attemptSsoHydrate() moments later. Best-effort: the caller clears its
// own local token regardless of whether this resolves.
export async function logoutSso(): Promise<void> {
  if (API_MODE !== 'ems') return
  try {
    await fetch(`${EMS_BASE}/auth/logout`, { method: 'POST', credentials: 'include' })
  } catch {
    // best-effort
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
  // claude_prompt.txt (this round, "revenue = stored total due"): no longer
  // computed from lines -- at quotation level this is simply the stored
  // `sales.quotations.total` (nullable: a quotation with no stored total
  // shows "--" and is excluded from sums, but still listed). At project/
  // grand level this is the plain sum of member quotations' revenue
  // (null treated as a 0 contribution), so it's never null there in
  // practice. `revenueCostedIncVat` is gone -- there is no "line-costed
  // revenue" concept any more (profit = revenue - cost directly).
  revenueIncVat: number | null
  // Total cost = Σ costed part/stock cost + Σ shipping cost + Σ import tax
  // -- unchanged from the prior round.
  costQuoted: number
  costBank: number
  // claude_prompt.txt: "profit = revenue (stored total) - cost" -- null
  // whenever revenue is null (no replacement computation).
  profitQuoted: number | null
  profitBank: number | null
  bufferGain: number
  linesWithoutCost: number
  // claude_prompt.txt (this round): informational only now -- shipping and
  // import tax ARE counted in revenue/cost/profit/margin above; these two
  // fields carry the subtotals the Revenue KPI sub-line needs.
  passThroughImportTax: number
  passThroughShipping: { cost: number; priceIncVat: number }
}
export type CostProfitLine = {
  kind: 'part' | 'stock' | 'shipping' | 'import_tax' | 'ctl' | 'discount'
  name: string
  qty: number
  unit: string | null
  unitCostFc: number | null
  markupPercent: number | null
  unitPriceIncVat: number | null
  // claude_prompt.txt (this round): renamed from `revenueExVat` -- always
  // the VAT-inclusive amount now. `passThrough` is gone -- shipping/import
  // tax rows are still grouped into the page's separate reference block,
  // but purely by `kind`, not by a numeric exclusion flag (they now count
  // in every total).
  revenueIncVat: number
  costQuoted: number | null
  costBank: number | null
  costKnown: boolean
  // claude_prompt.txt ("Cost & Profit report — shipping/import tax as
  // reference rows"): per-item import tax ('part' lines only; null for
  // 'stock' lines and every other kind, or when the lot has no import tax).
  importTaxAmount: number | null
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
  // claude_prompt.txt ("Cost & Profit report — shipping/import tax as
  // reference rows"): raw transfer fee (THB) -- used to build the
  // reference block's shipping sub-text without re-parsing the line name.
  transferFee: number | null
  lines: CostProfitLine[]
}
// claude_prompt.txt ("Cost & Profit report display improvements"): null
// when there is no discount on this quotation.
export type CostProfitDiscount = { amountIncVat: number; percentOfPartsSubtotal: number } | null

// claude_prompt.txt ("... discount-price table, Excel basis"): "what if
// this quotation's items AND shipping were discounted d%, Excel-style" --
// always present now (previously null when the quotation had its own
// discount; this round's text makes it always present, based on prices
// BEFORE the quotation's own discount, as in Excel).
export type CostProfitDiscountScenario = {
  discountPercent: number
  totalPriceIncVat: number
  profit: number
  profitExcelBasis: number
  margin: number
  // claude_prompt.txt ("Cost & Profit report: two totals, numbers equal to
  // the Excel sheet"): additive fields for the discount table's new
  // columns -- Quotation total = revenue + shipping charged + import tax
  // (import tax undiscounted); Revenue = goods price x (1-d); Cost is the
  // quotation's own two-totals Cost, constant across every row, carried in
  // both basis variants here (unlike the five fields above, which stay
  // quoted-basis-only, unchanged).
  quotationTotal: number
  revenue: number
  costQuoted: number
  costBank: number
  profitQuoted: number
  profitBank: number
  marginQuoted: number
  marginBank: number
}

// claude_prompt.txt ("... two totals"): the report page's own
// Quotation-total/Revenue/Cost/Profit bundle -- kept separate from
// CostProfitTotals (which the dashboard reads unchanged) so this page can
// show its own two totals without affecting the dashboard's numbers.
export type CostProfitTwoTotals = {
  quotationTotal: number | null
  revenue: number
  costQuoted: number
  costBank: number
  profitQuoted: number
  profitBank: number
}

export type CostProfitQuotation = {
  id: string
  number: string
  status: 'accepted' | 'sent'
  statusDate: string
  statusDateEstimated: boolean
  totals: CostProfitTotals
  twoTotals: CostProfitTwoTotals
  // claude_prompt.txt: "keep reconcile exactly as it is" -- unchanged in
  // meaning; widened to `| null` since the stored total it compares
  // against can itself be null.
  reconcile: { headerTotal: number | null; computedIncVat: number; diff: number | null }
  discount: CostProfitDiscount
  // claude_prompt.txt ("show the discount percentage..."): straight
  // pass-through of the stored `discount_value` column -- never reused
  // from, or merged into, `discount.percentOfPartsSubtotal` above (that
  // stays a derived figure; this is the raw stored percent, read as-is).
  discountPercent: number | null
  discountScenarios: CostProfitDiscountScenario[]
  // claude_prompt.txt ("... Excel basis"): total selling price inc. VAT
  // (items + shipping, before the quotation's own discount) minus total
  // cost (items + shipping cost). Import tax excluded. Two variants,
  // mirroring totals.profitQuoted/profitBank, so the page's existing
  // Quoted/Bank toggle drives this card the same way it drives Profit.
  profitExcelBasisQuoted: number
  profitExcelBasisBank: number
  groups: CostProfitGroup[]
}
export type CostProfitProject = {
  projectId: string | null
  name: string
  clientName: string
  totals: CostProfitTotals
  twoTotals: CostProfitTwoTotals
  profitExcelBasisQuoted: number
  profitExcelBasisBank: number
  quotations: CostProfitQuotation[]
}
export type CostProfitReport = {
  month: string
  statuses: ('accepted' | 'sent')[]
  totals: CostProfitTotals
  twoTotals: CostProfitTwoTotals
  profitExcelBasisQuoted: number
  profitExcelBasisBank: number
  projects: CostProfitProject[]
}

// claude_prompt.txt ("... monthly Dashboard"), 1.2 -- mirrors
// ems-backend's cost-profit-calculator.ts MonthlyCostProfitReport exactly.
export type CostProfitMonthlySummary = {
  month: string
  quotationCount: number
  revenue: number
  cost: number
  profit: number
  margin: number | null
}
export type CostProfitMonthlyProjectSummary = {
  projectName: string
  revenue: number
  cost: number
  profit: number
  margin: number | null
}
export type CostProfitMonthlyReport = {
  month: string
  months: CostProfitMonthlySummary[]
  averageMargin: number | null
  previousMonthMargin: number | null
  projects: CostProfitMonthlyProjectSummary[]
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

  // claude_prompt.txt (this round): `credentials: 'include'` added -- this
  // is the response that sets the shared `ems_sso` cookie (see
  // ems-backend's AuthController.login()); without it the browser drops
  // the Set-Cookie header on this cross-origin response.
  login: (email: string, password: string): Promise<LoginResult> =>
    request(`${EMS_BASE}/auth/login`, { method: 'POST', body: JSON.stringify({ email, password }), credentials: 'include' }),

  getCostProfit: (month: string, statuses: ('accepted' | 'sent')[]): Promise<CostProfitReport> =>
    request(`${EMS_BASE}/sales/reports/cost-profit?month=${encodeURIComponent(month)}&statuses=${statuses.join(',')}`),

  getCostProfitMonthly: (month: string, months = 7): Promise<CostProfitMonthlyReport> =>
    request(`${EMS_BASE}/sales/reports/cost-profit/monthly?month=${encodeURIComponent(month)}&months=${months}`),
}
