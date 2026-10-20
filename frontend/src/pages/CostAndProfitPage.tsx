import { useEffect, useMemo, useState } from 'react'
import { api, attemptSsoHydrate, getToken, setUnauthorizedHandler, type CostProfitGroup, type CostProfitLine, type CostProfitProject, type CostProfitReport, type CostProfitTwoTotals } from '../services/api'
import LoginScreen from './LoginScreen'
import CostProfitDashboard from './CostProfitDashboard'

// claude_prompt.txt ("Cost & Profit report"), Part 2. Standalone page,
// reachable only by URL (no menu link) -- wired in from main.tsx via a
// plain pathname check, not a router (the app has none and this is the
// only second route it needs). Imports services/api.ts like every other
// page, so the module-level SSO fragment consumption there still runs the
// same way when this page is opened directly.
//
// claude_prompt.txt ("Cost & Profit report — shipping and import tax as
// separate reference rows, new layout/colours, discount-price table"):
// restyled to match cost_profit_mock_reference.html (layout/spacing/
// colours/weights/texts copied from the mock; its demo data/logic and the
// DCLogic wrapper were not). Everything not covered by that task --
// toggles, month control, routing, SSO, loading/error states, existing
// chips, the discount row, the "Profit before discount" line, zero-priced
// package lines, the manual-rate band, collapse behaviour -- keeps its
// prior behavior unchanged, restyled only.

const fmt2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const money = (n: number | null | undefined) => (n == null ? '—' : fmt2.format(n))

// claude_prompt.txt ("Margin display: 3 decimal places on the Cost & Profit
// report page"): round half up at the 3rd decimal, display-only -- never
// touches the profit/revenue numbers themselves. Mirrors the plain
// `Math.round(n * k) / k` shape of the backend's own round1()/round2() in
// cost-profit-calculator.ts (no sign special-casing), just at 3 decimals.
function roundHalfUp3(n: number): number {
  return Math.round(n * 1000) / 1000
}

// claude_prompt.txt (this round): revenue/profit are nullable now (a
// quotation with no stored total) -- null-safe on both sides, same "--"
// result as a non-positive denominator.
const pctStr = (numerator: number | null, denominator: number | null) =>
  numerator != null && denominator != null && denominator > 0 ? `${roundHalfUp3((numerator / denominator) * 100).toFixed(3)}%` : '—'

// claude_prompt.txt ("final theme and layout"), section 1: "Profit pills:
// positive #A7F3D0 / #047857, negative #FEE4E2 / #B42318" -- this pair
// covers every pill (with background) AND every plain margin-text colour
// in the report (stat cells, item rows, reference rows, discount table).
const POS = '#047857'
const NEG = '#B42318'
const posBg = '#A7F3D0'
const negBg = '#FEE4E2'
const profitColor = (v: number) => (v < 0 ? NEG : POS)
const profitBg = (v: number) => (v < 0 ? negBg : posBg)
// claude_prompt.txt, section 8: "Summary cards ... Profit and Margin
// values: #12B76A when positive, #F04438 when negative" -- a separate,
// backgroundless pair used only by the two KPI cards below (Gross profit,
// Margin), distinct from the pill pair above.
const SUMMARY_POS = '#12B76A'
const SUMMARY_NEG = '#F04438'
const summaryColor = (v: number) => (v < 0 ? SUMMARY_NEG : SUMMARY_POS)

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function formatMonthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

function formatStatusDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

type Basis = 'quoted' | 'bank'
type View = 'report' | 'dashboard'

function lineCost(line: { costQuoted: number | null; costBank: number | null; costKnown: boolean }, basis: Basis): number | null {
  if (!line.costKnown) return null
  return basis === 'quoted' ? line.costQuoted : line.costBank
}

function totalsForBasis(t: CostProfitReport['totals'], basis: Basis) {
  const cost = basis === 'quoted' ? t.costQuoted : t.costBank
  const profit = basis === 'quoted' ? t.profitQuoted : t.profitBank
  return { cost, profit }
}

// claude_prompt.txt ("Cost & Profit report: two totals, numbers equal to
// the Excel sheet"): same basis-pick helper as totalsForBasis() above, for
// the new Quotation-total/Revenue/Cost/Profit bundle.
function twoTotalsForBasis(t: CostProfitTwoTotals, basis: Basis) {
  const cost = basis === 'quoted' ? t.costQuoted : t.costBank
  const profit = basis === 'quoted' ? t.profitQuoted : t.profitBank
  return { quotationTotal: t.quotationTotal, revenue: t.revenue, cost, profit }
}

// claude_prompt.txt (this round), 2.1: the stored discount amount in its
// own stat cell -- "--" when there is none (q.discount is null).
function discountAmountOf(q: { discount: { amountIncVat: number } | null }): number | null {
  return q.discount?.amountIncVat ?? null
}

// claude_prompt.txt ("show the discount percentage..."): "strip trailing
// zeros: 10, 12.5; never 10.00" -- round to 2dp first (the stored column is
// numeric(14,2), so this only ever trims float noise, never real precision)
// then let Number#toString drop trailing zeros naturally.
function formatPercentStripZeros(n: number): string {
  return parseFloat(n.toFixed(2)).toString()
}

// claude_prompt.txt ("... Excel basis"): profitExcelBasisQuoted/Bank are
// top-level fields (report/project/quotation), not nested inside `totals`
// -- this picks the one matching the page's existing Quoted/Bank toggle,
// the same way `totalsForBasis` already does for the plain Profit figure.
function excelBasisForBasis(t: { profitExcelBasisQuoted: number; profitExcelBasisBank: number }, basis: Basis): number {
  return basis === 'quoted' ? t.profitExcelBasisQuoted : t.profitExcelBasisBank
}

function groupBandText(group: CostProfitGroup): string {
  if (group.kind === 'stock') return 'Cost shown only where a snapshot exists on the quotation line'
  if (group.kind === 'other') return ''
  if (group.currency === 'THB') return `Local supplier · THB · rate 1`
  const sourceLabel = group.sourceType === 'local_supplier' || group.sourceType === 'local_purchase' ? 'Local supplier' : 'Import'
  const dateText = group.exchangeRateDate ? ` · rate of ${formatStatusDate(group.exchangeRateDate)}` : ''
  // claude_prompt.txt ("Cost & Profit report display improvements"): a
  // non-THB group with no actualExchangeRate was never given a real bank
  // rate -- say so explicitly instead of implying one with "Rate X".
  if (group.bankRateMissing) {
    return `${sourceLabel} · ${group.currency} · manual rate ${group.exchangeRate} · no bank reference${dateText}`
  }
  const rateText =
    group.actualExchangeRate != null && group.bufferPercent != null
      ? `Bank ${group.actualExchangeRate} + ${group.bufferPercent}% buffer = ${group.exchangeRate}`
      : `Rate ${group.exchangeRate}`
  return `${sourceLabel} · ${group.currency} · ${rateText}${dateText}`
}

// claude_prompt.txt: reference-block sub-text, shipping row --
// "<lot> · <CUR> <fc> × <rate> + transfer fee <fee>". Legacy groups (no
// shippingCostFc) have no FC/rate breakdown -- fall back to the group band
// text's own THB phrasing instead of fabricating one.
function shippingRefSub(group: CostProfitGroup, line: CostProfitLine, rate: number | null): string {
  if (group.currency === 'THB' || line.unitCostFc == null) {
    return `${group.sourceName} · ${fmt2.format(line.costQuoted ?? 0)} THB + transfer fee ${fmt2.format(group.transferFee ?? 0)}`
  }
  return `${group.sourceName} · ${group.currency} ${fmt2.format(line.unitCostFc)} × ${rate ?? '—'} + transfer fee ${fmt2.format(group.transferFee ?? 0)}`
}

type RefRow = { group: CostProfitGroup; line: CostProfitLine; rate: number | null }

export default function CostAndProfitPage() {
  const [loggedIn, setLoggedIn] = useState(() => !!getToken())
  // claude_prompt.txt ("SSO: opening a direct link to another app asks for
  // login again"): see the matching block in App.tsx -- same reasoning,
  // this page has its own independent `loggedIn` state.
  const [checkingSso, setCheckingSso] = useState(() => !getToken())
  const [view, setView] = useState<View>('report')
  const [month, setMonth] = useState<string>(currentMonth())
  const [includeSent, setIncludeSent] = useState(false)
  const [basis, setBasis] = useState<Basis>('quoted')
  const [data, setData] = useState<CostProfitReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [expandedProjects, setExpandedProjects] = useState<Set<string> | null>(null)
  const [expandedQuotations, setExpandedQuotations] = useState<Set<string> | null>(null)

  useEffect(() => {
    setUnauthorizedHandler(() => setLoggedIn(false))
    return () => setUnauthorizedHandler(null)
  }, [])

  // claude_prompt.txt (this round): same one-time SSO-bridge check as
  // App.tsx -- this page is reachable only by direct URL (no menu link,
  // see the file header), which makes it the single most common case this
  // task is fixing.
  useEffect(() => {
    if (loggedIn) return
    let cancelled = false
    attemptSsoHydrate().then((ok) => {
      if (cancelled) return
      if (ok) setLoggedIn(true)
      setCheckingSso(false)
    })
    return () => {
      cancelled = true
    }
  }, [loggedIn])

  const statuses = useMemo<('accepted' | 'sent')[]>(() => (includeSent ? ['accepted', 'sent'] : ['accepted']), [includeSent])

  useEffect(() => {
    if (!loggedIn) return

    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      setForbidden(false)

      try {
        const report = await api.getCostProfit(month, statuses)
        if (cancelled) return
        setData(report)
        // First project + its first quotation start expanded, only on first load for this fetch.
        setExpandedProjects(new Set(report.projects[0] ? [projectKey(report.projects[0])] : []))
        setExpandedQuotations(new Set(report.projects[0]?.quotations[0] ? [report.projects[0].quotations[0].id] : []))
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : 'Failed to load report'
        if (message.toLowerCase().includes('missing permission')) {
          setForbidden(true)
        } else {
          setError(message)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [month, statuses, loggedIn])

  if (!loggedIn) {
    if (checkingSso) return null
    return <LoginScreen onLoggedIn={() => setLoggedIn(true)} />
  }

  const toggleProject = (key: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev ?? [])
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  const toggleQuotation = (id: string) => {
    setExpandedQuotations((prev) => {
      const next = new Set(prev ?? [])
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const totals = data?.totals
  const basisTotals = totals ? totalsForBasis(totals, basis) : null
  const twoTotals = data?.twoTotals
  const basisTwoTotals = twoTotals ? twoTotalsForBasis(twoTotals, basis) : null

  return (
    <div className="cp-page">
      <style>{CSS}</style>

      <header className="cp-header">
        <div className="cp-title-block">
          <div className="cp-caption">Sales · Reports</div>
          <h1 className="cp-h1">Cost &amp; Profit by project</h1>
          <p className="cp-subtitle">Gross profit from quotations.</p>
          <div className="cp-caption cp-month-label">{formatMonthLabel(month)} · amounts in THB</div>
        </div>

        <div className="cp-controls">
          <div className="cp-control">
            <span className="cp-control-label">View</span>
            <div className="cp-segmented" role="group" aria-label="View">
              <button type="button" className={view === 'report' ? 'active' : ''} onClick={() => setView('report')}>Report</button>
              <button type="button" className={view === 'dashboard' ? 'active' : ''} onClick={() => setView('dashboard')}>Dashboard</button>
            </div>
          </div>

          {view === 'report' && (
            <>
              <div className="cp-control">
                <span className="cp-control-label">Month</span>
                <div className="cp-month-control">
                  <button type="button" aria-label="Previous month" onClick={() => setMonth((m) => shiftMonth(m, -1))}>‹</button>
                  <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
                  <button type="button" aria-label="Next month" onClick={() => setMonth((m) => shiftMonth(m, 1))}>›</button>
                </div>
              </div>

              <div className="cp-control">
                <span className="cp-control-label">Quotations</span>
                <div className="cp-segmented" role="group" aria-label="Quotations">
                  <button type="button" className={includeSent ? '' : 'active'} onClick={() => setIncludeSent(false)}>Accepted only</button>
                  <button type="button" className={includeSent ? 'active' : ''} onClick={() => setIncludeSent(true)}>+ Sent (forecast)</button>
                </div>
              </div>

              <div className="cp-control">
                <span className="cp-control-label">Cost basis</span>
                <div className="cp-segmented" role="group" aria-label="Cost basis">
                  <button type="button" className={basis === 'quoted' ? 'active' : ''} onClick={() => setBasis('quoted')}>Quoted rate</button>
                  <button type="button" className={basis === 'bank' ? 'active' : ''} onClick={() => setBasis('bank')}>Bank rate</button>
                </div>
              </div>
            </>
          )}
        </div>
      </header>

      {view === 'dashboard' && <CostProfitDashboard />}

      {view === 'report' && (
        <>
          {forbidden && <div className="cp-state cp-state-error">You do not have access to this report.</div>}
          {!forbidden && error && <div className="cp-state cp-state-error">{error}</div>}
          {!forbidden && !error && loading && <div className="cp-state">Loading…</div>}
          {!forbidden && !error && !loading && data && data.projects.length === 0 && (
            <div className="cp-state">No accepted quotations in this month.</div>
          )}

          {!forbidden && !error && !loading && data && data.projects.length > 0 && totals && basisTotals && twoTotals && basisTwoTotals && (
            <>
              <section className="cp-kpis">
                <div className="cp-kpi">
                  <div className="cp-kpi-label">Quotation total</div>
                  <div className="cp-kpi-value">{money(twoTotals.quotationTotal)}</div>
                  <div className="cp-kpi-sub">inc. VAT, after discount</div>
                </div>
                <div className="cp-kpi">
                  <div className="cp-kpi-label">Revenue</div>
                  <div className="cp-kpi-value">{money(twoTotals.revenue)}</div>
                  <div className="cp-kpi-sub">after discount</div>
                </div>
                <div className="cp-kpi">
                  <div className="cp-kpi-label">Cost</div>
                  <div className="cp-kpi-value">{money(basisTwoTotals.cost)}</div>
                  <div className="cp-kpi-sub">{basis === 'quoted' ? 'at quoted rate (incl. buffer)' : 'at bank rate, no buffer'}</div>
                </div>
                <div className="cp-kpi">
                  <div className="cp-kpi-label">Gross profit</div>
                  <div className="cp-kpi-value" style={{ color: summaryColor(basisTwoTotals.profit ?? 0) }}>{money(basisTwoTotals.profit)}</div>
                  <div className="cp-kpi-sub">
                    {totals.linesWithoutCost > 0 ? `excludes ${totals.linesWithoutCost} lines without cost` : 'all lines have cost'}
                  </div>
                </div>
                <div className="cp-kpi">
                  <div className="cp-kpi-label">Margin</div>
                  <div className="cp-kpi-value" style={{ color: summaryColor(basisTwoTotals.profit ?? 0) }}>
                    {pctStr(basisTwoTotals.profit, twoTotals.revenue)}
                  </div>
                  <div className="cp-kpi-sub">profit ÷ revenue</div>
                </div>
                <div className="cp-kpi">
                  <div className="cp-kpi-label">Buffer gain</div>
                  <div className="cp-kpi-value">{money(totals.bufferGain)}</div>
                  <div className="cp-kpi-sub">quoted rate vs bank rate, parts only</div>
                </div>
              </section>

              <section className="cp-projects">
                {data.projects.map((project) => {
                  const key = projectKey(project)
                  const expanded = expandedProjects?.has(key) ?? false
                  const pTwoBasis = twoTotalsForBasis(project.twoTotals, basis)
                  const pExcelBasis = excelBasisForBasis(project, basis)
                  return (
                    <div className="cp-project-card" key={key}>
                      <button type="button" className="cp-project-header" onClick={() => toggleProject(key)} aria-expanded={expanded}>
                        <span className="cp-chev">{expanded ? '▾' : '▸'}</span>
                        <span className="cp-project-title">
                          <span className="cp-project-name">{project.name}</span>
                          <span className="cp-project-meta">{project.clientName} · {project.quotations.length} quotation{project.quotations.length === 1 ? '' : 's'}</span>
                        </span>
                        <StatCells quotationTotal={pTwoBasis.quotationTotal} revenue={pTwoBasis.revenue} discount={undefined} discountPercent={undefined} cost={pTwoBasis.cost} profit={pTwoBasis.profit} margin={pctStr(pTwoBasis.profit, pTwoBasis.revenue)} excelBasis={pExcelBasis} size={16} />
                      </button>

                      {expanded && (
                        <div className="cp-quotations">
                          {project.quotations.map((q) => {
                            const qExpanded = expandedQuotations?.has(q.id) ?? false
                            const qTwoBasis = twoTotalsForBasis(q.twoTotals, basis)
                            const qExcelBasis = excelBasisForBasis(q, basis)
                            const reconcileFlag = q.reconcile.diff != null && Math.abs(q.reconcile.diff) > 0.05

                            // claude_prompt.txt: the reference block lists every
                            // shipping/import-tax line across every group of
                            // this quotation, once, after the last lot's item
                            // rows -- not interleaved per group.
                            const refRows: RefRow[] = []
                            q.groups.forEach((group) => {
                              const rate = basis === 'quoted' ? group.exchangeRate : group.actualExchangeRate
                              const shipLine = group.lines.find((l) => l.kind === 'shipping')
                              if (shipLine) refRows.push({ group, line: shipLine, rate })
                              const taxLine = group.lines.find((l) => l.kind === 'import_tax')
                              if (taxLine) refRows.push({ group, line: taxLine, rate })
                            })

                            return (
                              <div className="cp-quotation-panel" key={q.id}>
                                <button type="button" className="cp-quotation-header" onClick={() => toggleQuotation(q.id)} aria-expanded={qExpanded}>
                                  <span className="cp-chev">{qExpanded ? '▾' : '▸'}</span>
                                  <span className="cp-quotation-title">
                                    <span className="cp-quotation-number">{q.number}</span>
                                    <span className={`cp-chip cp-chip-${q.status}`}>
                                      {q.status === 'accepted' ? `Accepted ${formatStatusDate(q.statusDate)}` : `Sent ${formatStatusDate(q.statusDate)} · forecast`}
                                    </span>
                                    {q.discount && <span className="cp-chip cp-chip-neutral">Discount {q.discount.percentOfPartsSubtotal}%</span>}
                                    {q.totals.linesWithoutCost > 0 && (
                                      <span className="cp-chip cp-chip-warning">{q.totals.linesWithoutCost} lines without cost</span>
                                    )}
                                    {reconcileFlag && <span className="cp-chip cp-chip-warning">total differs</span>}
                                    {q.statusDateEstimated && <span className="cp-muted-note">date estimated</span>}
                                  </span>
                                  <StatCells quotationTotal={qTwoBasis.quotationTotal} revenue={qTwoBasis.revenue} discount={discountAmountOf(q)} discountPercent={q.discountPercent} cost={qTwoBasis.cost} profit={qTwoBasis.profit} margin={pctStr(qTwoBasis.profit, qTwoBasis.revenue)} excelBasis={qExcelBasis} size={15} />
                                </button>

                                {qExpanded && (
                                  <div className="cp-table-scroll">
                                    <div className="cp-table">
                                      <div className="cp-row cp-header-row">
                                        <span>Item</span><span className="cp-num">Qty</span><span className="cp-num">Cost FC / unit</span>
                                        <span className="cp-num">Rate</span><span className="cp-num">Cost THB (total)</span><span className="cp-num">Markup</span>
                                        <span className="cp-num">Unit price inc. VAT</span><span className="cp-num">Import tax</span>
                                        <span className="cp-num">Revenue inc. VAT</span><span className="cp-num">Profit</span><span className="cp-num">Margin</span>
                                      </div>

                                      {q.groups.map((group, gIdx) => (
                                        <div key={`group-${gIdx}`}>
                                          {group.kind !== 'other' && (
                                            <div className="cp-lot-band">
                                              <span className="cp-lot-name">{group.sourceName}{group.country ? ` (${group.country})` : ''}</span>
                                              {groupBandText(group) && <span className="cp-lot-detail">{groupBandText(group)}</span>}
                                            </div>
                                          )}
                                          {group.lines
                                            .filter((l) => l.kind !== 'shipping' && l.kind !== 'import_tax')
                                            .map((line, lIdx) => (
                                              <ItemRow key={`line-${gIdx}-${lIdx}`} line={line} group={group} basis={basis} />
                                            ))}
                                        </div>
                                      ))}

                                      {refRows.length > 0 && (
                                        <>
                                          <div className="cp-ref-head">
                                            Shipping and import tax
                                          </div>
                                          {refRows.map((r, idx) => (
                                            <ReferenceRow key={`ref-${idx}`} row={r} basis={basis} />
                                          ))}
                                        </>
                                      )}
                                    </div>
                                  </div>
                                )}

                                {/* claude_prompt.txt ("Cost & Profit report: two totals, numbers
                                equal to the Excel sheet"), section 5: columns now
                                Discount | Quotation total | Revenue | Cost | Profit | Margin,
                                values per the task's own Definitions ("Revenue = goods price
                                x (1-d); Quotation total = Revenue + shipping charged + import
                                tax, import tax undiscounted; the discount is taken from the
                                goods price only, never from shipping"). Cost/Profit/Margin now
                                follow the page's Quoted/Bank toggle too (s.costQuoted/costBank
                                etc.) -- the prior round's Cost/Profit were quoted-basis-only
                                regardless of the toggle; fixed here as part of the same
                                recomputation, see PROGRESS_LOG.md "judgement calls". */}
                                {qExpanded && (
                                  <div className="cp-discount-table">
                                    <div className="cp-discount-head">
                                      Price with discount
                                    </div>
                                    <div className="cp-discount-row cp-discount-header">
                                      <span>Discount</span><span className="cp-num">Quotation total</span><span className="cp-num">Revenue</span><span className="cp-num">Cost</span><span className="cp-num">Profit</span><span className="cp-num">Margin</span>
                                    </div>
                                    {q.discountScenarios.map((s) => {
                                      const sCost = basis === 'quoted' ? s.costQuoted : s.costBank
                                      const sProfit = basis === 'quoted' ? s.profitQuoted : s.profitBank
                                      // claude_prompt.txt ("Margin display: 3 decimal places..."):
                                      // computed here from s.profit/s.revenue (full precision)
                                      // rather than read from the backend's own marginQuoted/
                                      // marginBank fields -- those are rounded to 1 decimal at
                                      // the source (round1() in cost-profit-calculator.ts), which
                                      // the task's own rule forbids changing ("do not round the
                                      // underlying number... backend field"), so they can't carry
                                      // 3 decimals of real precision. pctStr() already does the
                                      // same thing for the header/KPI margins.
                                      const sMarginStr = pctStr(sProfit, s.revenue)
                                      return (
                                        <div className="cp-discount-row" key={s.discountPercent}>
                                          <span className="cp-discount-label">{s.discountPercent === 0 ? 'No discount' : `${s.discountPercent}%`}</span>
                                          <span className="cp-num">{money(s.quotationTotal)}</span>
                                          <span className="cp-num">{money(s.revenue)}</span>
                                          <span className="cp-num">{money(sCost)}</span>
                                          <span className="cp-num cp-profit-pill" style={{ color: profitColor(sProfit), background: profitBg(sProfit) }}>{money(sProfit)}</span>
                                          <span className="cp-num cp-margin-text" style={{ color: profitColor(sProfit) }}>{sMarginStr}</span>
                                        </div>
                                      )
                                    })}
                                  </div>
                                )}

                                {/* claude_prompt.txt ("Cost & Profit report display improvements"):
                                muted summary line, only when this quotation has a discount.
                                claude_prompt.txt ("... two totals"): re-derived from the new
                                Revenue/Profit (twoTotals) instead of the old stored-total
                                revenue -- still correct under the new definitions: Revenue +
                                discount = goods price and Profit + discount = goods price -
                                Cost, both of which equal the discount table's own "No discount"
                                row exactly (hand-verified against the reference quotation in
                                PROGRESS_LOG.md), so this line is kept rather than removed. */}
                                {qExpanded && q.discount && (() => {
                                  const discountAmount = q.discount.amountIncVat
                                  const revenueBeforeDiscount = qTwoBasis.revenue + discountAmount
                                  const profitBeforeDiscount = qTwoBasis.profit != null ? qTwoBasis.profit + discountAmount : null
                                  const marginBeforeDiscount =
                                    profitBeforeDiscount != null && revenueBeforeDiscount > 0
                                      ? (profitBeforeDiscount / revenueBeforeDiscount) * 100
                                      : null
                                  return (
                                    <div className="cp-profit-before-discount">
                                      Profit before discount: {money(profitBeforeDiscount)}
                                      {marginBeforeDiscount != null ? ` (${marginBeforeDiscount.toFixed(1)}% margin)` : ''}
                                    </div>
                                  )
                                })()}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </section>
            </>
          )}
        </>
      )}
    </div>
  )
}

// claude_prompt.txt ("Cost & Profit report: two totals, numbers equal to
// the Excel sheet"), section 2: "Quotation header stat cells, in this
// order: Quotation total, Discount, Revenue, Cost, Profit, Margin. Project
// header: Quotation total, empty Discount-width spacer, Revenue, Cost,
// Profit, Margin ... the new Quotation total cell uses the style of the
// existing Revenue cell." `discount === undefined` means "no Discount cell
// at all" (the project header spacer) -- distinct from `null`, which is a
// real quotation with no stored discount amount ("--").
function StatCells({ quotationTotal, revenue, discount, discountPercent, cost, profit, margin, excelBasis, size }: { quotationTotal: number | null; revenue: number | null; discount: number | null | undefined; discountPercent: number | null | undefined; cost: number | null; profit: number | null; margin: string; excelBasis: number; size: number }) {
  const hasProfit = profit != null
  // claude_prompt.txt ("final theme and layout"), section 6: "Keep the
  // backend fields and the excelBasisForBasis helper as they are; only
  // stop rendering them" -- callers still compute and pass excelBasis
  // (so the helper keeps being called, unchanged), this just no longer
  // renders a cell for it; `void` keeps the prop a real, intentional use.
  void excelBasis
  // claude_prompt.txt ("show the discount percentage..."): second line
  // under the amount, only when BOTH the amount and the percentage are > 0.
  const showPercent = discount != null && discount > 0 && discountPercent != null && discountPercent > 0
  return (
    <span className="cp-stat-cells">
      <span className="cp-stat-cell cp-stat-qtotal cp-stat-revenue">
        <span className="cp-stat-label">Quotation total</span>
        <span className="cp-stat-value" style={{ fontSize: size }}>{money(quotationTotal)}</span>
      </span>
      <span className="cp-stat-cell cp-stat-discount">
        {discount !== undefined && (
          <>
            <span className="cp-stat-label">Discount</span>
            {discount != null && discount > 0 ? (
              <span className="cp-stat-value cp-discount-pill" style={{ fontSize: 15, color: '#B45309', background: '#FEF3C7' }}>−{money(discount)}</span>
            ) : (
              <span className="cp-stat-value cp-discount-none" style={{ fontSize: 15, color: '#8A97D1' }}>—</span>
            )}
            {showPercent && (
              <span className="cp-discount-percent" style={{ color: '#B45309' }}>{formatPercentStripZeros(discountPercent as number)}%</span>
            )}
          </>
        )}
      </span>
      <span className="cp-stat-cell cp-stat-revenue">
        <span className="cp-stat-label">Revenue</span>
        <span className="cp-stat-value" style={{ fontSize: size }}>{money(revenue)}</span>
      </span>
      <span className="cp-stat-cell cp-stat-cost">
        <span className="cp-stat-label">Cost</span>
        <span className="cp-stat-value" style={{ fontSize: size }}>{money(cost)}</span>
      </span>
      <span className="cp-stat-cell cp-stat-profit">
        <span className="cp-stat-label">Profit</span>
        <span
          className="cp-stat-value cp-profit-pill"
          style={{ fontSize: size, color: hasProfit ? profitColor(profit as number) : '#5B6BB5', background: hasProfit ? profitBg(profit as number) : 'transparent' }}
        >
          {money(profit)}
        </span>
      </span>
      <span className="cp-stat-cell cp-stat-margin">
        <span className="cp-stat-label">Margin</span>
        <span className="cp-stat-value cp-margin-text" style={{ fontSize: size, color: hasProfit ? profitColor(profit as number) : '#5B6BB5' }}>{margin}</span>
      </span>
    </span>
  )
}

function ItemRow({ line, group, basis }: { line: CostProfitLine; group: CostProfitGroup; basis: Basis }) {
  // claude_prompt.txt ("Cost & Profit report display improvements"):
  // discount row -- neutral ink (never red), no margin, "(reduces
  // revenue)" in the name, profit cell shows the negative amount plainly.
  if (line.kind === 'discount') {
    return (
      <div className="cp-row cp-row-discount">
        <span className="cp-item-name">Discount (reduces revenue)</span>
        <span className="cp-num">—</span><span className="cp-num">—</span><span className="cp-num">—</span>
        <span className="cp-num">{money(0)}</span><span className="cp-num">—</span>
        <span className="cp-num">{line.unitPriceIncVat != null ? `−${money(Math.abs(line.unitPriceIncVat))}` : '—'}</span>
        <span className="cp-num">—</span>
        <span className="cp-num">−{money(Math.abs(line.revenueIncVat))}</span>
        <span className="cp-num">−{money(Math.abs(line.revenueIncVat))}</span>
        <span className="cp-num">—</span>
      </div>
    )
  }

  // claude_prompt.txt ("Cost & Profit report display improvements"):
  // zero-priced package component -- muted, suffixed, blank everywhere.
  const isZeroPricedPackageLine =
    (line.kind === 'part' || line.kind === 'stock') && line.unitPriceIncVat === 0 && line.costKnown && line.costQuoted === 0
  if (isZeroPricedPackageLine) {
    return (
      <div className="cp-row cp-muted-row">
        <span className="cp-item-name">{line.name} · included in package</span>
        <span className="cp-num">—</span><span className="cp-num">—</span><span className="cp-num">—</span><span className="cp-num">—</span>
        <span className="cp-num">—</span><span className="cp-num">—</span><span className="cp-num">—</span><span className="cp-num">—</span>
        <span className="cp-num">—</span><span className="cp-num">—</span>
      </div>
    )
  }

  // 'ctl' and ordinary 'part'/'stock' lines share this layout.
  const cost = lineCost(line, basis)
  const profit = line.costKnown && cost != null ? line.revenueIncVat - cost : null
  const margin = profit != null && line.revenueIncVat > 0 ? (profit / line.revenueIncVat) * 100 : null
  const rate = basis === 'quoted' ? group.exchangeRate : group.actualExchangeRate
  const isFc = group.kind === 'external' && group.currency && group.currency !== 'THB'
  return (
    <div className="cp-row">
      <span className="cp-item-name-cell">
        <span className="cp-item-name">{line.name}</span>
      </span>
      <span className="cp-num cp-muted">{line.qty}</span>
      <span className="cp-num cp-muted">{isFc && line.unitCostFc != null ? `${group.currency} ${fmt2.format(line.unitCostFc)}` : '—'}</span>
      <span className="cp-num cp-muted">{isFc && rate != null ? rate : '—'}</span>
      <span className="cp-num">{money(cost)}</span>
      <span className="cp-num cp-muted">{line.markupPercent != null ? `${line.markupPercent}%` : '—'}</span>
      <span className="cp-num cp-muted">{line.unitPriceIncVat != null ? money(line.unitPriceIncVat) : '—'}</span>
      <span className="cp-num cp-muted">{line.kind === 'part' && line.importTaxAmount != null ? money(line.importTaxAmount) : '—'}</span>
      <span className="cp-num">{money(line.revenueIncVat)}</span>
      <span className={`cp-num ${profit != null ? 'cp-profit-pill' : ''}`} style={profit != null ? { color: profitColor(profit), background: profitBg(profit) } : undefined}>
        {profit != null ? money(profit) : '—'}
      </span>
      <span className="cp-num cp-margin-text" style={margin != null ? { color: profitColor(profit as number) } : undefined}>
        {margin != null ? `${roundHalfUp3(margin).toFixed(3)}%` : '—'}
      </span>
    </div>
  )
}

function ReferenceRow({ row, basis }: { row: RefRow; basis: Basis }) {
  const { group, line, rate } = row
  if (line.kind === 'shipping') {
    // claude_prompt.txt ("Cost & Profit report: two totals, numbers equal
    // to the Excel sheet"), section 4: "Shipping row: Unit price = amount
    // charged to the customer; Cost = shipping cost without transfer fee;
    // Revenue '—'; Profit = minus the Cost, shown as plain text (no
    // coloured pill); Margin '—'." Cost-without-fee is derived here, not
    // from a new backend field -- `group.transferFee` is already exposed
    // and the fee is the same flat THB add-on under either basis (see
    // cost-profit-calculator.ts's shippingRevenueExVat()).
    const costWithFee = lineCost(line, basis)
    const costNoFee = costWithFee != null ? costWithFee - (group.transferFee ?? 0) : null
    return (
      <div className="cp-row cp-ref-row">
        <span className="cp-item-name-cell">
          <span className="cp-item-name cp-muted">Estimated shipping</span>
          <span className="cp-ref-sub">{shippingRefSub(group, line, rate)}</span>
        </span>
        <span className="cp-num cp-muted">1</span>
        <span className="cp-num cp-muted">{group.currency !== 'THB' && line.unitCostFc != null ? `${group.currency} ${fmt2.format(line.unitCostFc)}` : '—'}</span>
        <span className="cp-num cp-muted">{group.currency !== 'THB' && rate != null ? rate : '—'}</span>
        <span className="cp-num cp-muted">{money(costNoFee)}</span>
        <span className="cp-num cp-muted">—</span>
        <span className="cp-num cp-muted">{money(line.unitPriceIncVat)}</span>
        <span className="cp-num cp-muted">0.00</span>
        <span className="cp-num cp-muted">—</span>
        <span className="cp-num">{costNoFee != null ? `−${money(costNoFee)}` : '—'}</span>
        <span className="cp-num cp-muted">—</span>
      </div>
    )
  }
  // claude_prompt.txt ("... two totals"), section 4: "Import tax row: only
  // the Import tax column carries the amount; Cost, Revenue, Profit and
  // Margin show '—'."
  return (
    <div className="cp-row cp-ref-row">
      <span className="cp-item-name-cell">
        <span className="cp-item-name cp-muted">Import tax</span>
        <span className="cp-ref-sub">{group.sourceName}</span>
      </span>
      <span className="cp-num cp-muted">1</span>
      <span className="cp-num cp-muted">—</span>
      <span className="cp-num cp-muted">—</span>
      <span className="cp-num cp-muted">—</span>
      <span className="cp-num cp-muted">—</span>
      <span className="cp-num cp-muted">—</span>
      <span className="cp-num cp-muted">{money(line.revenueIncVat)}</span>
      <span className="cp-num cp-muted">—</span>
      <span className="cp-num cp-muted">—</span>
      <span className="cp-num cp-muted">—</span>
    </div>
  )
}

function projectKey(project: CostProfitProject): string {
  return project.projectId ?? '__no_project__'
}

const CSS = `
.cp-page { background:#F3F4F6; color:#1B2559; min-height:100vh; max-width:1564px; margin:0 auto; padding:32px 40px 56px; font-family: var(--font-ui, 'Inter', system-ui, sans-serif); }
.cp-page .cp-num { font-variant-numeric: tabular-nums; text-align:right; font-weight:400; }
.cp-header { display:flex; flex-wrap:wrap; justify-content:space-between; gap:18px; align-items:flex-end; }
.cp-title-block { display:flex; flex-direction:column; gap:4px; max-width:640px; }
.cp-caption { font-size:12px; color:#5B6BB5; text-transform:uppercase; letter-spacing:0.08em; }
.cp-h1 { font-size:28px; font-weight:700; color:#1B2559; margin:0; }
.cp-subtitle { color:#5B6BB5; margin:0; font-size:14px; }
.cp-month-label { margin-top:6px; letter-spacing:0.06em; }
.cp-controls { display:flex; flex-wrap:wrap; align-items:flex-end; gap:14px; }
.cp-control { display:flex; flex-direction:column; gap:4px; }
.cp-control-label { font-size:11px; color:#5B6BB5; text-transform:uppercase; letter-spacing:0.06em; font-weight:500; }
.cp-month-control { display:flex; align-items:center; gap:4px; background:#fff; border:1px solid #DDE3E9; border-radius:8px; padding:8px 14px; }
.cp-month-control button { background:none; border:none; cursor:pointer; font-size:16px; color:#1B2559; }
.cp-month-control input { border:none; font-family:inherit; font-size:14px; font-weight:500; }
.cp-segmented { display:flex; border:1px solid #DDE3E9; border-radius:8px; overflow:hidden; background:#fff; }
.cp-segmented button { background:#fff; border:none; padding:8px 14px; font-size:14px; cursor:pointer; color:#1B2559; }
.cp-segmented button.active { background:#1B2559; color:#fff; }
.cp-state { background:#fff; border:1px solid #DDE3E9; border-radius:8px; padding:24px; text-align:center; color:#5B6BB5; margin-top:16px; }
.cp-state-error { color:#B42318; }
.cp-kpis { display:grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap:14px; margin:22px 0 22px; }
.cp-kpi { background:#fff; border:1px solid #DDE3E9; border-radius:10px; padding:16px 18px; display:flex; flex-direction:column; gap:6px; }
.cp-kpi-label { font-size:12px; font-weight:500; color:#5B6BB5; }
.cp-kpi-value { font-size:24px; font-weight:700; text-align:left; font-variant-numeric: tabular-nums; color:#0891B2; }
.cp-kpi-sub { font-size:12px; color:#5B6BB5; }
.cp-projects { display:flex; flex-direction:column; gap:22px; }
.cp-project-card { background:#fff; border:1px solid #DDE3E9; border-radius:12px; overflow:hidden; }
.cp-quotations { background:#fff; padding:14px 22px 22px; display:flex; flex-direction:column; gap:16px; }
.cp-quotation-panel { background:#fff; border:1px solid #DDE3E9; border-radius:10px; overflow:hidden; }
.cp-project-header, .cp-quotation-header { width:100%; display:flex; flex-wrap:wrap; align-items:center; gap:16px; border:0; cursor:pointer; text-align:left; color:#1B2559; }
.cp-project-header { background:#fff; padding:18px 41px 18px 22px; }
.cp-quotation-header { background:#fff; padding:14px 18px; gap:12px; }
.cp-chev { width:16px; font-size:14px; color:#5B6BB5; flex-shrink:0; }
.cp-project-title { flex:1 1 260px; display:flex; flex-direction:column; gap:3px; }
.cp-project-name { font-size:19px; font-weight:700; color:#1B2559; }
.cp-project-meta { font-size:13px; color:#5B6BB5; }
.cp-quotation-title { flex:1 1 280px; display:flex; flex-wrap:wrap; align-items:center; gap:10px; }
.cp-quotation-number { font-size:15px; font-weight:700; letter-spacing:0.01em; color:#1B2559; }
.cp-stat-cells { display:flex; gap:18px; margin-left:auto; }
.cp-stat-cell { display:flex; flex-direction:column; align-items:flex-end; gap:3px; }
.cp-stat-revenue, .cp-stat-cost, .cp-stat-discount { width:120px; }
.cp-stat-profit { width:140px; }
.cp-discount-pill { font-weight:600; padding:2px 10px; border-radius:7px; justify-self:end; margin-right:-10px; }
.cp-discount-none { font-weight:600; }
.cp-discount-percent { font-size:11px; font-weight:600; text-align:right; }
.cp-stat-margin { width:82px; }
.cp-stat-label { font-size:11px; font-weight:500; color:#5B6BB5; }
.cp-stat-value { font-variant-numeric: tabular-nums; color:#1B2559; }
.cp-stat-profit .cp-stat-value { font-weight:700; }
.cp-stat-margin .cp-stat-value { font-weight:600; }
.cp-chip { font-size:12px; padding:2px 9px; border-radius:999px; }
.cp-chip-accepted { background:#A7F3D0; color:#047857; }
.cp-chip-sent { background:#E0E7FF; color:#3730A3; }
.cp-chip-warning { background:#FDE68A; color:#B45309; }
.cp-chip-neutral { background:#FEF3C7; color:#B45309; }
.cp-muted-note { font-size:11px; color:#5B6BB5; }
.cp-profit-before-discount { padding:8px 18px 14px; font-size:12px; color:#5B6BB5; }
.cp-table-scroll { overflow-x:auto; border-top:1px solid #DDE3E9; background:#fff; padding:4px 18px 18px; }
.cp-table { min-width:1310px; display:flex; flex-direction:column; }
.cp-row { display:grid; grid-template-columns: minmax(230px,2.6fr) 48px 128px 64px 118px 62px 118px 104px 124px 112px 76px; column-gap:12px; align-items:center; padding:10px; background:#fff; border-bottom:1px solid #EAEEF1; font-size:14px; }
.cp-row:not(.cp-header-row) { transition: box-shadow .12s; }
.cp-row:not(.cp-header-row):hover { box-shadow: inset 0 0 0 9999px rgba(107,114,128,0.14); }
.cp-header-row { background:#E5E7EB; font-size:12px; font-weight:600; color:#2F3E86; border-radius:6px; border-bottom:none; margin-top:0; padding:9px 10px; }
.cp-lot-band { margin-top:14px; padding:9px 10px; background:#F3F4F6; border-left:3px solid #4B5563; border-radius:4px; display:flex; flex-wrap:wrap; gap:4px 14px; align-items:baseline; }
.cp-lot-name { font-size:14px; font-weight:700; color:#1B2559; }
.cp-lot-detail { font-size:12px; font-weight:400; color:#5B6BB5; }
.cp-item-name-cell { display:flex; flex-direction:column; gap:0; }
.cp-item-name { font-weight:500; color:#1B2559; }
.cp-muted-row .cp-item-name { color:#8A97D1; }
.cp-ref-sub { font-size:12px; color:#8A97D1; }
.cp-muted { color:#5B6BB5 !important; }
.cp-profit-pill { font-weight:700; padding:2px 9px; border-radius:6px; justify-self:end; margin-right:-9px; }
.cp-margin-text { font-weight:600; }
.cp-ref-head { margin-top:22px; padding:8px 10px; background:#E5E7EB; border-left:3px solid #9CA3AF; border-radius:4px; font-size:13px; font-weight:700; color:#2F3E86; }
.cp-ref-head-note { font-weight:400; color:#5B6875; }
.cp-ref-row { background:#fff; }
.cp-row-discount { background:#FEF3C7; color:#B45309; }
.cp-row-discount .cp-item-name,
.cp-row-discount .cp-num { color:#B45309; }
.cp-discount-table { margin:24px 18px 18px; max-width:880px; border:1px solid #DDE3E9; border-radius:8px; overflow:hidden; }
.cp-discount-head { padding:9px 12px; background:#E5E7EB; font-size:13px; font-weight:700; color:#2F3E86; }
.cp-discount-row { display:grid; grid-template-columns: 110px 140px 140px 140px 140px 86px; column-gap:16px; align-items:center; padding:9px 12px; border-bottom:1px solid #EAEEF1; font-size:14px; }
.cp-discount-header { font-size:12px; font-weight:600; color:#5B6BB5; background:transparent; border-bottom:1px solid #EAEEF1; padding:8px 12px; }
.cp-discount-label { font-weight:600; }
.cp-discount-row .cp-num { font-variant-numeric: tabular-nums; text-align:right; }
@media (max-width: 640px) {
  .cp-page { padding:16px; }
  .cp-controls { width:100%; }
}
`
