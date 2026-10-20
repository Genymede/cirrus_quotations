import { useEffect, useRef, useState } from 'react'
import { api, type CostProfitMonthlyProjectSummary, type CostProfitMonthlyReport } from '../services/api'

// claude_prompt.txt ("Cost & Profit report — revenue incl. VAT, shipping
// and import tax in totals, +15% width, monthly Dashboard"), section 2.3.
// Self-contained Dashboard tab for CostAndProfitPage.tsx -- fetches the new
// read-only monthly endpoint directly (no placeholder data). Layout/colours
// copied from cost_profit_mock_reference.html's Dashboard section; its demo
// data/logic and the DCLogic wrapper were not.

const fmt2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const money = (n: number | null | undefined) => (n == null ? '—' : fmt2.format(n))

// claude_prompt.txt ("final theme and layout"), section 1: pill pair --
// used only by "Profit by project" row-level numbers (section 9: "keep
// their green/red text colours", i.e. this pair, not the summary pair).
const POS = '#047857'
const NEG = '#B42318'
// claude_prompt.txt, section 8: summary-card pair -- Profit and Profit
// margin KPI values (and their delta sub-text) use this instead.
const SUMMARY_POS = '#12B76A'
const SUMMARY_NEG = '#F04438'
const MUTED = '#5B6BB5'

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(month: string): { short: string; full: string } {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1, 1))
  return {
    short: d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }),
    full: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
  }
}

function kfmt(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(2)}M`
  return `${Math.round(n / 1000)}k`
}

export default function CostProfitDashboard() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [data, setData] = useState<CostProfitMonthlyReport | null>(null)
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)
  const [projectsByMonth, setProjectsByMonth] = useState<Record<string, CostProfitMonthlyProjectSummary[]>>({})
  const [projectsLoading, setProjectsLoading] = useState(false)
  const anchorMonthRef = useRef<string>(currentMonth())

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      setForbidden(false)
      try {
        const report = await api.getCostProfitMonthly(anchorMonthRef.current, 7)
        if (cancelled) return
        setData(report)
        setSelectedIdx(report.months.length - 1)
        setProjectsByMonth({ [report.month]: report.projects })
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : 'Failed to load dashboard'
        if (message.toLowerCase().includes('missing permission')) setForbidden(true)
        else setError(message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  async function selectMonth(idx: number) {
    setSelectedIdx(idx)
    if (!data) return
    const monthKey = data.months[idx].month
    if (projectsByMonth[monthKey]) return
    setProjectsLoading(true)
    try {
      const monthly = await api.getCostProfitMonthly(monthKey, 1)
      setProjectsByMonth((prev) => ({ ...prev, [monthKey]: monthly.projects }))
    } catch {
      // Leave the chart empty for this month rather than surfacing a second
      // page-level error -- the KPI cards above still reflect the already
      // loaded window, only the project breakdown for this one month fails.
    } finally {
      setProjectsLoading(false)
    }
  }

  if (forbidden) return <div className="cp-state cp-state-error">You do not have access to this report.</div>
  if (error) return <div className="cp-state cp-state-error">{error}</div>
  if (loading || !data || selectedIdx == null) return <div className="cp-state">Loading…</div>

  const monthsWithQuotations = data.months.filter((m) => m.quotationCount > 0)
  if (monthsWithQuotations.length === 0) {
    return <div className="cp-state">No accepted or sent quotations in any of the months shown.</div>
  }

  const sel = data.months[selectedIdx]
  const selMargin = sel.margin
  const isAnchor = selectedIdx === data.months.length - 1
  // claude_prompt.txt: "sub: ▲/▼ x.x pp vs <prev month>, or 'first month
  // shown' if the previous month has no quotations" -- the anchor month
  // uses the backend's own previousMonthMargin (correct even when it falls
  // outside the fetched window, e.g. months=1); any other selected month
  // compares to its immediate neighbour already inside `data.months`.
  const prevMargin = isAnchor ? data.previousMonthMargin : (selectedIdx > 0 ? data.months[selectedIdx - 1].margin : null)
  const delta = selMargin != null && prevMargin != null ? selMargin - prevMargin : null
  const prevLabel = selectedIdx > 0 ? monthLabel(data.months[selectedIdx - 1].month).short : null

  const maxRev = Math.max(1, ...data.months.map((m) => m.revenue))
  const marginValues = data.months.map((m) => m.margin ?? 0)
  const maxMargin = Math.max(50, ...marginValues.map(Math.abs))
  const avgPx = data.averageMargin != null ? Math.round((data.averageMargin / maxMargin) * 190) : null

  const projects = projectsByMonth[sel.month] ?? []
  const maxProfit = Math.max(1, ...projects.map((p) => p.profit))

  return (
    <>
      <div className="cp-caption cp-dash-caption">Accepted quotations · quoted-rate cost · month = issue date</div>

      <section className="cp-kpis cp-dash-kpis">
        <div className="cp-kpi">
          <div className="cp-kpi-label">Revenue · {monthLabel(sel.month).full}</div>
          <div className="cp-kpi-value">{money(sel.revenue)}</div>
          <div className="cp-kpi-sub">inc. VAT, THB</div>
        </div>
        <div className="cp-kpi">
          <div className="cp-kpi-label">Profit</div>
          <div className="cp-kpi-value" style={{ color: sel.profit < 0 ? SUMMARY_NEG : SUMMARY_POS }}>{money(sel.profit)}</div>
          <div className="cp-kpi-sub">revenue − cost</div>
        </div>
        <div className="cp-kpi">
          <div className="cp-kpi-label">Profit margin</div>
          <div className="cp-kpi-value" style={{ color: (selMargin ?? 0) < 0 ? SUMMARY_NEG : SUMMARY_POS }}>{selMargin != null ? `${selMargin.toFixed(1)}%` : '—'}</div>
          <div className="cp-kpi-sub" style={{ color: delta == null ? MUTED : delta >= 0 ? SUMMARY_POS : SUMMARY_NEG, fontWeight: 600 }}>
            {delta == null ? 'first month shown' : `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(1)} pp vs ${prevLabel}`}
          </div>
        </div>
        <div className="cp-kpi">
          <div className="cp-kpi-label">Average margin</div>
          <div className="cp-kpi-value">{data.averageMargin != null ? `${data.averageMargin.toFixed(1)}%` : '—'}</div>
          <div className="cp-kpi-sub">across the {monthsWithQuotations.length} months shown</div>
        </div>
      </section>

      <div className="cp-dash-charts">
        <div className="cp-dash-card">
          <div className="cp-dash-card-head">
            <span className="cp-dash-card-title">Revenue, cost and profit by month</span>
            <span className="cp-dash-legend">
              <span><i style={{ background: '#67D4E4' }} />Cost</span>
              <span><i style={{ background: '#0E7490' }} />Profit</span>
            </span>
          </div>
          <div className="cp-dash-bars-row">
            {data.months.map((m, i) => {
              const profit = m.profit
              const hCost = Math.round((Math.min(m.cost, m.revenue) / maxRev) * 200)
              const hProfit = Math.round((Math.max(profit, 0) / maxRev) * 200)
              return (
                <button type="button" key={m.month} className="cp-dash-col" style={{ background: i === selectedIdx ? '#E6F7FA' : 'transparent' }} onClick={() => void selectMonth(i)}>
                  <span className="cp-dash-col-label cp-num">{m.quotationCount > 0 ? kfmt(m.revenue) : '—'}</span>
                  <span className="cp-dash-col-bar">
                    <span style={{ height: `${hProfit}px`, background: '#0E7490', borderRadius: '4px 4px 0 0' }} />
                    <span style={{ height: `${hCost}px`, background: '#67D4E4' }} />
                  </span>
                  <span className="cp-dash-col-month" style={{ fontWeight: i === selectedIdx ? 700 : 500 }}>{monthLabel(m.month).short}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="cp-dash-card">
          <div className="cp-dash-card-head">
            <span className="cp-dash-card-title">Profit margin by month</span>
            <span className="cp-dash-legend">
              <span><i style={{ background: '#67D4E4' }} />Margin</span>
              <span><i className="cp-dash-dash" />Average {data.averageMargin != null ? `${data.averageMargin.toFixed(1)}%` : '—'}</span>
            </span>
          </div>
          <div className="cp-dash-margin-row">
            {avgPx != null && <span className="cp-dash-avg-line" style={{ bottom: `${avgPx}px` }} />}
            {data.months.map((m, i) => {
              const h = Math.round((Math.abs(m.margin ?? 0) / maxMargin) * 190)
              return (
                <button type="button" key={m.month} className="cp-dash-mcol" style={{ background: i === selectedIdx ? '#E6F7FA' : 'transparent' }} onClick={() => void selectMonth(i)}>
                  <span className="cp-num cp-dash-mcol-label">{m.margin != null ? `${m.margin.toFixed(1)}%` : '—'}</span>
                  <span className="cp-dash-mcol-bar" style={{ height: `${h}px`, background: i === selectedIdx ? '#0E7490' : '#67D4E4' }} />
                </button>
              )
            })}
          </div>
          <div className="cp-dash-margin-labels">
            {data.months.map((m, i) => (
              <span key={m.month} style={{ fontWeight: i === selectedIdx ? 700 : 500 }}>{monthLabel(m.month).short}</span>
            ))}
          </div>
        </div>

        <div className="cp-dash-card cp-dash-card-wide">
          <div className="cp-dash-card-head">
            <span className="cp-dash-card-title">Profit by project · {monthLabel(sel.month).full}</span>
            <span className="cp-dash-card-note">bar = profit, right side = margin</span>
          </div>
          {projectsLoading && <div className="cp-state">Loading…</div>}
          {!projectsLoading && projects.length === 0 && <div className="cp-state">No quotations in this month.</div>}
          {!projectsLoading && projects.length > 0 && (
            <div className="cp-dash-project-rows">
              <div className="cp-dash-project-row cp-dash-project-header">
                <span>Project</span><span /><span className="cp-num">Profit</span><span className="cp-num">Margin</span>
              </div>
              {projects.map((p) => (
                <div className="cp-dash-project-row" key={p.projectName}>
                  <span className="cp-dash-project-name">{p.projectName}</span>
                  <span className="cp-dash-project-bar-track"><span className="cp-dash-project-bar" style={{ width: `${Math.max(2, Math.round((p.profit / maxProfit) * 100))}%` }} /></span>
                  <span className="cp-num cp-dash-project-profit" style={{ color: p.profit < 0 ? NEG : POS }}>{money(p.profit)}</span>
                  <span className="cp-num cp-dash-project-margin" style={{ color: p.profit < 0 ? NEG : POS }}>{p.margin != null ? `${p.margin.toFixed(1)}%` : '—'}</span>
                  {/* claude_prompt.txt ("final theme and layout"), section 9: "The profit and margin
                      numbers beside them keep their green/red text colours" -- explicit carve-out,
                      these two stay on the pill pair (POS/NEG) above, not the summary pair. */}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <style>{DASH_CSS}</style>
    </>
  )
}

const DASH_CSS = `
.cp-dash-caption { margin: 2px 0 18px; }
.cp-dash-kpis { grid-template-columns: repeat(4, minmax(0, 1fr)); margin-top: 0; }
.cp-dash-kpis .cp-kpi-value { font-size: 26px; }
.cp-dash-charts { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 14px; margin-top: 14px; }
.cp-dash-card { background: #fff; border: 1px solid #DDE3E9; border-radius: 12px; padding: 18px 20px; display: flex; flex-direction: column; gap: 12px; }
.cp-dash-card-wide { grid-column: 1 / -1; }
.cp-dash-card-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 8px; }
.cp-dash-card-title { font-size: 16px; font-weight: 700; color: #1B2559; }
.cp-dash-card-note { font-size: 12px; color: #5B6BB5; }
.cp-dash-legend { font-size: 12px; color: #5B6BB5; display: flex; gap: 14px; align-items: center; }
.cp-dash-legend span { display: inline-flex; align-items: center; gap: 5px; }
.cp-dash-legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; }
.cp-dash-legend i.cp-dash-dash { width: 16px; height: 0; border-top: 2px dashed #5B6BB5; border-radius: 0; }
.cp-dash-bars-row { display: flex; gap: 6px; align-items: flex-end; }
.cp-dash-col { flex: 1 1 0; min-width: 0; border: 0; border-radius: 8px; padding: 8px 2px; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 4px; color: #1B2559; font-family: inherit; }
.cp-dash-col-label { font-size: 11px; color: #5B6BB5; }
.cp-dash-col-bar { display: flex; flex-direction: column; justify-content: flex-end; height: 200px; width: 100%; max-width: 44px; }
.cp-dash-col-month { font-size: 12px; }
.cp-dash-margin-row { position: relative; display: flex; gap: 6px; align-items: flex-end; height: 250px; border-bottom: 1px solid #DDE3E9; }
.cp-dash-avg-line { position: absolute; left: 0; right: 0; border-top: 2px dashed #5B6BB5; opacity: 0.8; }
.cp-dash-mcol { flex: 1 1 0; min-width: 0; border: 0; background: none; border-radius: 8px 8px 0 0; padding: 0 2px; cursor: pointer; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 4px; height: 100%; font-family: inherit; }
.cp-dash-mcol-label { font-size: 12px; font-weight: 600; color: #1B2559; }
.cp-dash-mcol-bar { width: 100%; max-width: 44px; border-radius: 4px 4px 0 0; }
.cp-dash-margin-labels { display: flex; gap: 6px; }
.cp-dash-margin-labels span { flex: 1 1 0; min-width: 0; text-align: center; font-size: 12px; }
.cp-dash-project-rows { display: flex; flex-direction: column; gap: 2px; }
.cp-dash-project-row { display: grid; grid-template-columns: minmax(160px,1.2fr) minmax(200px,3fr) 120px 70px; column-gap: 16px; align-items: center; padding: 6px 0; }
.cp-dash-project-header { font-size: 12px; font-weight: 600; color: #5B6BB5; padding-bottom: 6px; border-bottom: 1px solid #EAEEF1; }
.cp-dash-project-name { font-size: 14px; font-weight: 600; color: #1B2559; }
.cp-dash-project-bar-track { height: 16px; background: #EEF2F5; border-radius: 4px; overflow: hidden; }
.cp-dash-project-bar { display: block; height: 16px; background: #67D4E4; border-radius: 4px; }
.cp-dash-project-profit, .cp-dash-project-margin { font-size: 14px; font-weight: 700; }
@media (max-width: 900px) {
  .cp-dash-charts { grid-template-columns: 1fr; }
}
`
