import { useEffect, useMemo, useState } from 'react'
import { api, getToken, setUnauthorizedHandler, type CostProfitProject, type CostProfitReport } from '../services/api'
import LoginScreen from './LoginScreen'

// claude_prompt.txt ("Cost & Profit report"), Part 2. Standalone page,
// reachable only by URL (no menu link) -- wired in from main.tsx via a
// plain pathname check, not a router (the app has none and this is the
// only second route it needs). Imports services/api.ts like every other
// page, so the module-level SSO fragment consumption there still runs the
// same way when this page is opened directly.

const fmt2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const money = (n: number | null | undefined) => (n == null ? '—' : fmt2.format(n))

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

function lineCost(line: { costQuoted: number | null; costBank: number | null; costKnown: boolean }, basis: Basis): number | null {
  if (!line.costKnown) return null
  return basis === 'quoted' ? line.costQuoted : line.costBank
}

function totalsForBasis(t: CostProfitReport['totals'], basis: Basis) {
  const cost = basis === 'quoted' ? t.costQuoted : t.costBank
  const profit = basis === 'quoted' ? t.profitQuoted : t.profitBank
  return { cost, profit }
}

function groupBandText(group: CostProfitProject['quotations'][number]['groups'][number]): string {
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

function lineName(line: CostProfitProject['quotations'][number]['groups'][number]['lines'][number]): string {
  return line.name
}

export default function CostAndProfitPage() {
  const [loggedIn, setLoggedIn] = useState(() => !!getToken())
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

  return (
    <div className="cp-page">
      <style>{CSS}</style>

      <header className="cp-header">
        <div>
          <div className="cp-caption">Sales · Reports</div>
          <h1 className="cp-h1">Cost &amp; Profit by project</h1>
          <p className="cp-subtitle">
            Gross profit from quotations. Revenue is shown before VAT 7%. Import tax is a pass-through and is not
            counted in revenue, cost or margin.
          </p>
        </div>

        <div className="cp-controls">
          <div className="cp-month-control">
            <button type="button" aria-label="Previous month" onClick={() => setMonth((m) => shiftMonth(m, -1))}>‹</button>
            <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
            <button type="button" aria-label="Next month" onClick={() => setMonth((m) => shiftMonth(m, 1))}>›</button>
          </div>

          <div className="cp-segmented" role="group" aria-label="Quotations">
            <button type="button" className={includeSent ? '' : 'active'} onClick={() => setIncludeSent(false)}>Accepted only</button>
            <button type="button" className={includeSent ? 'active' : ''} onClick={() => setIncludeSent(true)}>+ Sent (forecast)</button>
          </div>

          <div className="cp-segmented" role="group" aria-label="Cost basis">
            <button type="button" className={basis === 'quoted' ? 'active' : ''} onClick={() => setBasis('quoted')}>Quoted rate</button>
            <button type="button" className={basis === 'bank' ? 'active' : ''} onClick={() => setBasis('bank')}>Bank rate</button>
          </div>
        </div>
      </header>

      <div className="cp-caption cp-month-label">{formatMonthLabel(month)} · amounts in THB</div>

      {forbidden && <div className="cp-state cp-state-error">You do not have access to this report.</div>}
      {!forbidden && error && <div className="cp-state cp-state-error">{error}</div>}
      {!forbidden && !error && loading && <div className="cp-state">Loading…</div>}
      {!forbidden && !error && !loading && data && data.projects.length === 0 && (
        <div className="cp-state">No accepted quotations in this month.</div>
      )}

      {!forbidden && !error && !loading && data && data.projects.length > 0 && totals && basisTotals && (
        <>
          <section className="cp-kpis">
            <div className="cp-kpi">
              <div className="cp-kpi-label">Revenue (ex. VAT)</div>
              <div className="cp-kpi-value">{money(totals.revenueExVat)}</div>
              <div className="cp-kpi-sub">excludes {money(totals.passThroughImportTax)} import tax pass-through</div>
            </div>
            <div className="cp-kpi">
              <div className="cp-kpi-label">Cost</div>
              <div className="cp-kpi-value">{money(basisTotals.cost)}</div>
              <div className="cp-kpi-sub">{basis === 'quoted' ? 'at quoted rate (incl. buffer)' : 'at bank rate, no buffer'}</div>
            </div>
            <div className="cp-kpi">
              <div className="cp-kpi-label">Gross profit</div>
              <div className={`cp-kpi-value ${basisTotals.profit < 0 ? 'cp-negative' : 'cp-positive'}`}>{money(basisTotals.profit)}</div>
              <div className="cp-kpi-sub">
                {totals.linesWithoutCost > 0 ? `excludes ${totals.linesWithoutCost} lines without cost` : 'all lines have cost'}
              </div>
            </div>
            <div className="cp-kpi">
              <div className="cp-kpi-label">Margin</div>
              <div className="cp-kpi-value">
                {totals.revenueCosted > 0 ? `${((basisTotals.profit / totals.revenueCosted) * 100).toFixed(1)}%` : '—'}
              </div>
              <div className="cp-kpi-sub">profit ÷ revenue, import tax excluded</div>
            </div>
            <div className="cp-kpi">
              <div className="cp-kpi-label">Buffer gain</div>
              <div className="cp-kpi-value">{money(totals.bufferGain)}</div>
              <div className="cp-kpi-sub">quoted rate vs bank rate, FC items</div>
            </div>
          </section>

          <section className="cp-projects">
            {data.projects.map((project) => {
              const key = projectKey(project)
              const expanded = expandedProjects?.has(key) ?? false
              const pBasis = totalsForBasis(project.totals, basis)
              return (
                <div className="cp-project-card" key={key}>
                  <button type="button" className="cp-project-header" onClick={() => toggleProject(key)} aria-expanded={expanded}>
                    <div className="cp-project-title">
                      <span className="cp-project-name">{project.name}</span>
                      <span className="cp-project-meta">{project.clientName} · {project.quotations.length} quotation{project.quotations.length === 1 ? '' : 's'}</span>
                    </div>
                    <div className="cp-project-figures">
                      <span>Revenue {money(project.totals.revenueExVat)}</span>
                      <span>Cost {money(pBasis.cost)}</span>
                      <span className={pBasis.profit < 0 ? 'cp-negative' : 'cp-positive'}>Profit {money(pBasis.profit)}</span>
                      <span>Margin {project.totals.revenueCosted > 0 ? `${((pBasis.profit / project.totals.revenueCosted) * 100).toFixed(1)}%` : '—'}</span>
                    </div>
                  </button>

                  {expanded && (
                    <div className="cp-quotations">
                      {project.quotations.map((q) => {
                        const qExpanded = expandedQuotations?.has(q.id) ?? false
                        const qBasis = totalsForBasis(q.totals, basis)
                        const reconcileFlag = Math.abs(q.reconcile.diff) > 0.05
                        return (
                          <div className="cp-quotation-panel" key={q.id}>
                            <button type="button" className="cp-quotation-header" onClick={() => toggleQuotation(q.id)} aria-expanded={qExpanded}>
                              <span className="cp-quotation-number">{q.number}</span>
                              <span className={`cp-chip cp-chip-${q.status}`}>
                                {q.status === 'accepted' ? `Accepted ${formatStatusDate(q.statusDate)}` : `Sent ${formatStatusDate(q.statusDate)} · forecast`}
                              </span>
                              {q.discount && <span className="cp-chip cp-chip-neutral">Discount {q.discount.percentOfPartsSubtotal}%</span>}
                              {q.totals.passThroughImportTax > 0 && (
                                <span className="cp-chip cp-chip-neutral">Import tax {money(q.totals.passThroughImportTax)} pass-through</span>
                              )}
                              {q.totals.linesWithoutCost > 0 && (
                                <span className="cp-chip cp-chip-warning">{q.totals.linesWithoutCost} lines without cost</span>
                              )}
                              {reconcileFlag && <span className="cp-chip cp-chip-warning">total differs</span>}
                              {q.statusDateEstimated && <span className="cp-muted-note">date estimated</span>}
                              <span className="cp-quotation-figures">
                                <span>Revenue {money(q.totals.revenueExVat)}</span>
                                <span>Cost {money(qBasis.cost)}</span>
                                <span className={qBasis.profit < 0 ? 'cp-negative' : 'cp-positive'}>Profit {money(qBasis.profit)}</span>
                              </span>
                            </button>

                            {qExpanded && (
                              <div className="cp-table-scroll">
                                <table className="cp-table">
                                  <thead>
                                    <tr>
                                      <th>Item</th>
                                      <th>Qty</th>
                                      <th>Cost FC / unit</th>
                                      <th>Rate</th>
                                      <th>Cost THB (total)</th>
                                      <th>Markup</th>
                                      <th>Unit price inc. VAT</th>
                                      <th>Revenue ex. VAT</th>
                                      <th>Profit</th>
                                      <th>Margin</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {q.groups.map((group, gIdx) => (
                                      <>
                                        {group.kind !== 'other' && (
                                          <tr className="cp-group-band" key={`band-${gIdx}`}>
                                            <td colSpan={10}>
                                              <strong>{group.sourceName}</strong>
                                              {group.country ? ` · ${group.country}` : ''}
                                              {groupBandText(group) && <span className="cp-muted-note"> — {groupBandText(group)}</span>}
                                            </td>
                                          </tr>
                                        )}
                                        {group.lines.map((line, lIdx) => {
                                          // claude_prompt.txt ("Cost & Profit report adjustments"): import tax is a
                                          // pass-through -- stays visible, muted, with its amount shown only in the
                                          // "Unit price inc. VAT" column. Never shows a percent (even when
                                          // import_tax_percent exists), and contributes to no displayed total (the
                                          // backend already excludes it from every totals field).
                                          if (line.passThrough) {
                                            return (
                                              <tr key={`line-${gIdx}-${lIdx}`} className="cp-passthrough-row">
                                                <td className="cp-item-name">Import tax · pass-through, not counted</td>
                                                <td className="cp-num">{line.qty}</td>
                                                <td className="cp-num">—</td>
                                                <td className="cp-num">—</td>
                                                <td className="cp-num">—</td>
                                                <td className="cp-num">—</td>
                                                <td className="cp-num">{line.unitPriceIncVat != null ? money(line.unitPriceIncVat) : '—'}</td>
                                                <td className="cp-num">—</td>
                                                <td className="cp-num">—</td>
                                                <td className="cp-num">—</td>
                                              </tr>
                                            )
                                          }

                                          // claude_prompt.txt ("Cost & Profit report display improvements"):
                                          // discount row -- neutral ink (never red), no margin, "(reduces
                                          // revenue)" in the name, profit cell shows the negative amount plainly.
                                          if (line.kind === 'discount') {
                                            return (
                                              <tr key={`line-${gIdx}-${lIdx}`}>
                                                <td className="cp-item-name">Discount (reduces revenue)</td>
                                                <td className="cp-num">—</td>
                                                <td className="cp-num">—</td>
                                                <td className="cp-num">—</td>
                                                <td className="cp-num">{money(0)}</td>
                                                <td className="cp-num">—</td>
                                                <td className="cp-num">{line.unitPriceIncVat != null ? money(line.unitPriceIncVat) : '—'}</td>
                                                <td className="cp-num">{money(line.revenueExVat)}</td>
                                                <td className="cp-num">{money(line.revenueExVat)}</td>
                                                <td className="cp-num">—</td>
                                              </tr>
                                            )
                                          }

                                          // claude_prompt.txt ("Cost & Profit report display improvements"):
                                          // zero-priced package component -- muted, suffixed, blank everywhere.
                                          const isZeroPricedPackageLine =
                                            (line.kind === 'part' || line.kind === 'stock') &&
                                            line.unitPriceIncVat === 0 &&
                                            line.costKnown &&
                                            line.costQuoted === 0
                                          if (isZeroPricedPackageLine) {
                                            return (
                                              <tr key={`line-${gIdx}-${lIdx}`} className="cp-passthrough-row">
                                                <td className="cp-item-name">{lineName(line)} · included in package</td>
                                                <td className="cp-num">—</td>
                                                <td className="cp-num">—</td>
                                                <td className="cp-num">—</td>
                                                <td className="cp-num">—</td>
                                                <td className="cp-num">—</td>
                                                <td className="cp-num">—</td>
                                                <td className="cp-num">—</td>
                                                <td className="cp-num">—</td>
                                                <td className="cp-num">—</td>
                                              </tr>
                                            )
                                          }

                                          const cost = lineCost(line, basis)
                                          const profit = line.costKnown && cost != null ? line.revenueExVat - cost : null
                                          const margin = profit != null && line.revenueExVat > 0 ? (profit / line.revenueExVat) * 100 : null
                                          const rate = basis === 'quoted' ? group.exchangeRate : group.actualExchangeRate
                                          const isFc = group.kind === 'external' && group.currency && group.currency !== 'THB'
                                          return (
                                            <tr key={`line-${gIdx}-${lIdx}`}>
                                              <td className="cp-item-name">{lineName(line)}</td>
                                              <td className="cp-num">{line.qty}</td>
                                              <td className="cp-num">{isFc && line.unitCostFc != null ? `${group.currency} ${fmt2.format(line.unitCostFc)}` : '—'}</td>
                                              <td className="cp-num">{isFc && rate != null ? rate : '—'}</td>
                                              <td className="cp-num">{money(cost)}</td>
                                              <td className="cp-num">{line.markupPercent != null ? `${line.markupPercent}%` : '—'}</td>
                                              <td className="cp-num">{line.unitPriceIncVat != null ? money(line.unitPriceIncVat) : '—'}</td>
                                              <td className="cp-num">{money(line.revenueExVat)}</td>
                                              <td className={`cp-num ${profit != null && profit < 0 ? 'cp-negative' : ''}`}>{profit != null ? money(profit) : '—'}</td>
                                              <td className="cp-num">{margin != null ? `${margin.toFixed(1)}%` : '—'}</td>
                                            </tr>
                                          )
                                        })}
                                      </>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}

                            {/* claude_prompt.txt ("Cost & Profit report display improvements"):
                                muted summary line, only when this quotation has a discount. */}
                            {qExpanded && q.discount && (() => {
                              const discountLine = q.groups.flatMap((g) => g.lines).find((l) => l.kind === 'discount')
                              const discountRevenue = discountLine ? Math.abs(discountLine.revenueExVat) : 0
                              const profitBeforeDiscount = qBasis.profit != null ? qBasis.profit + discountRevenue : null
                              const revenueBeforeDiscount = q.totals.revenueCosted + discountRevenue
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
    </div>
  )
}

function projectKey(project: CostProfitProject): string {
  return project.projectId ?? '__no_project__'
}

const CSS = `
.cp-page { background:#F3F5F7; color:#16202A; min-height:100vh; max-width:1360px; margin:0 auto; padding:40px; font-family: var(--font-ui, 'Inter', system-ui, sans-serif); }
.cp-page .cp-table, .cp-page .cp-kpi-value, .cp-page .cp-num, .cp-page .cp-project-figures, .cp-page .cp-quotation-figures { font-family: var(--font-mono, 'IBM Plex Mono', monospace); font-variant-numeric: tabular-nums; }
.cp-header { display:flex; flex-wrap:wrap; justify-content:space-between; gap:16px; align-items:flex-start; }
.cp-caption { font-size:12px; color:#5B6875; text-transform:uppercase; letter-spacing:0.06em; }
.cp-h1 { font-size:22px; margin:4px 0; }
.cp-subtitle { color:#5B6875; margin:0; font-size:13px; }
.cp-controls { display:flex; flex-wrap:wrap; gap:10px; align-items:center; }
.cp-month-control { display:flex; align-items:center; gap:4px; background:#fff; border:1px solid #DDE3E9; border-radius:8px; padding:4px 8px; }
.cp-month-control button { background:none; border:none; cursor:pointer; font-size:16px; color:#16202A; }
.cp-month-control input { border:none; font-family: var(--font-mono, monospace); }
.cp-segmented { display:flex; border:1px solid #DDE3E9; border-radius:8px; overflow:hidden; }
.cp-segmented button { background:#fff; border:none; padding:6px 12px; font-size:13px; cursor:pointer; color:#5B6875; }
.cp-segmented button.active { background:#0F766E; color:#fff; }
.cp-month-label { margin:12px 0; }
.cp-state { background:#fff; border:1px solid #DDE3E9; border-radius:8px; padding:24px; text-align:center; color:#5B6875; }
.cp-state-error { color:#B42318; }
.cp-kpis { display:flex; flex-wrap:wrap; gap:12px; margin:16px 0 24px; }
.cp-kpi { background:#fff; border:1px solid #DDE3E9; border-radius:8px; padding:14px 16px; flex:1 1 180px; min-width:160px; }
.cp-kpi-label { font-size:12px; color:#5B6875; }
.cp-kpi-value { font-size:20px; font-weight:600; margin-top:4px; }
.cp-kpi-sub { font-size:11px; color:#5B6875; margin-top:2px; }
.cp-positive { color:#067647; }
.cp-negative { color:#B42318; }
.cp-projects { display:flex; flex-direction:column; gap:12px; }
.cp-project-card { background:#fff; border:1px solid #DDE3E9; border-radius:8px; overflow:hidden; }
.cp-project-header { width:100%; display:flex; justify-content:space-between; align-items:center; gap:12px; background:none; border:none; padding:14px 16px; cursor:pointer; text-align:left; flex-wrap:wrap; }
.cp-project-title { display:flex; flex-direction:column; gap:2px; }
.cp-project-name { font-weight:600; }
.cp-project-meta { font-size:12px; color:#5B6875; }
.cp-project-figures, .cp-quotation-figures { display:flex; gap:14px; font-size:13px; }
.cp-quotations { border-top:1px solid #DDE3E9; display:flex; flex-direction:column; }
.cp-quotation-panel { border-top:1px solid #DDE3E9; }
.cp-quotation-panel:first-child { border-top:none; }
.cp-quotation-header { width:100%; display:flex; align-items:center; gap:10px; background:none; border:none; padding:12px 16px; cursor:pointer; text-align:left; flex-wrap:wrap; }
.cp-quotation-number { font-family: var(--font-mono, monospace); font-weight:600; }
.cp-chip { font-size:11px; padding:2px 8px; border-radius:999px; }
.cp-chip-accepted { background:#D1FADF; color:#05603A; }
.cp-chip-sent { background:#E0E7FF; color:#3730A3; }
.cp-chip-warning { background:#FEF0C7; color:#7A4B00; }
.cp-chip-neutral { background:#EEF3F6; color:#16202A; }
.cp-muted-note { font-size:11px; color:#5B6875; }
.cp-profit-before-discount { padding:8px 16px 12px; font-size:12px; color:#5B6875; }
.cp-table-scroll { overflow-x:auto; border-top:1px solid #DDE3E9; }
.cp-table { width:100%; min-width:1200px; border-collapse:collapse; font-size:12px; grid-template-columns: minmax(230px,2.6fr) 48px 128px 64px 118px 62px 118px 124px 112px 64px; }
.cp-table th { text-align:right; padding:8px 10px; color:#5B6875; font-weight:500; border-bottom:1px solid #DDE3E9; }
.cp-table th:first-child, .cp-table td.cp-item-name { text-align:left; }
.cp-table td { padding:7px 10px; border-bottom:1px solid #EEF3F6; }
.cp-table .cp-num { text-align:right; }
.cp-group-band td { background:#EEF3F6; font-family: var(--font-ui, sans-serif); padding:6px 10px; }
.cp-passthrough-row td { color:#5B6875; }
@media (max-width: 640px) {
  .cp-page { padding:16px; }
  .cp-controls { width:100%; }
}
`
