import { useEffect, useState } from 'react'
import { api } from '../services/api'
import { computeCtlTotal } from '../utils/generateQuotationPDF'
import {
  lotShipping,
  VAT_RATE,
  type CurrencyCode,
} from '../utils/externalPartsAllocation'
import { roundMoney } from '../utils/money'
import './QuotationView.css'

type Quotation = {
  id: string
  number: string
  company_id: string | null
  issue_date: string
  valid_until: string | null
  status: string
  currency: string
  project_id: string | null
  description: string | null
  parts_subtotal: string
  shipping_total: string
  import_tax_total: string
  ctl_total: string
  discount_value: string
  discount_amount: string
  tax_rate: string
  tax_amount: string
  total: string
  notes: string | null
  location: string | null
}

type Customer = {
  id: string
  name: string
  company_name: string | null
  email: string | null
  phone: string | null
}

type Project = {
  id: string
  name: string
  description: string
  status: string
  priority: string
}

type ExternalGroup = {
  id: string
  quotation_id: string
  source_type: string
  source_name: string
  country: string
  currency: string
  exchange_rate: string
  exchange_rate_date: string | null
  shipping_cost: string
  import_tax: string
  estimated_delivery: string | null
  warranty: string | null
  installation_included: boolean
  shipping_cost_fc: string | null
  transfer_fee: string | null
}

type ExternalPart = {
  id: string
  group_id: string
  part_name: string
  qty: string
  unit: string
  unit_cost: string
  unit_cost_thb: string
  markup_percent: string
  unit_price: string
  sort_order: number
}

type QuotationLine = {
  id: string
  quotation_id: string
  item_id: string | null
  description: string
  quantity: string
  unit_price: string
  total: string
  sort_order: number
  line_type: string
  unit: string | null
  brand: string | null
  part_no: string | null
  unit_cost: string | null
  currency: string | null
  exchange_rate: string | null
  markup_percent: string | null
  external_group_id: string | null
  external_part_id: string | null
  ctl_key: string | null
  line_notes: string | null
}

type CtlItem = {
  key: string
  days: number
  note: string
  label: string
  price: number
  total: number
  included: boolean
  technicians: number
  dayDescriptions: string[]
}

type QuotationResponse = {
  quotation: Quotation
  customer: Customer | null
  project: Project | null
  externalGroups: ExternalGroup[]
  externalParts: ExternalPart[]
  lines: QuotationLine[]
  ctlItems: CtlItem[]
}

type QuotationViewProps = {
  quotationId: string
  onBack: () => void
  onEdit: (quotationId: string) => void
}

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'expired', label: 'Expired' },
]

function formatDate(value: string | null) {
  if (!value) return '—'
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return '—'
  return new Date(year, month - 1, day).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function money(value: string | number | null | undefined) {
  const amount = Number(value || 0)
  return `฿ ${amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function groupCustomerShipping(group: ExternalGroup): number {
  const shippingCostFc =
    group.shipping_cost_fc != null ? Number(group.shipping_cost_fc) : null

  if (shippingCostFc != null) {
    const lot = lotShipping({
      shippingCostFc,
      rate: Number(group.exchange_rate) || 0,
      currency: group.currency as CurrencyCode,
      transferFee:
        group.transfer_fee != null ? Number(group.transfer_fee) : undefined,
    })
    return lot.customerShipping
  }

  return roundMoney(Number(group.shipping_cost || 0) * (1 + VAT_RATE))
}

function getStatusInfo(status: string) {
  const normalizedStatus = status.toLowerCase()
  switch (normalizedStatus) {
    case 'draft':
      return { label: 'Draft', step: 1 }
    case 'sent':
      return { label: 'Sent', step: 2 }
    case 'accepted':
      return { label: 'Accepted', step: 3 }
    case 'rejected':
      return { label: 'Rejected', step: 3 }
    case 'expired':
      return { label: 'Expired', step: 3 }
    default:
      return { label: status || 'Unknown', step: 1 }
  }
}

function QuotationView({ quotationId, onBack, onEdit }: QuotationViewProps) {
  const [data, setData] = useState<QuotationResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const [companyName, setCompanyName] = useState('')

  const loadQuotation = async () => {
    if (!quotationId) return
    setLoading(true)
    setError('')
    try {
      const quotationData = (await api.getQuotation(
        quotationId,
      )) as QuotationResponse
      setData(quotationData)
    } catch (err) {
      console.error('Failed to load quotation:', err)
      setError(err instanceof Error ? err.message : 'Failed to load quotation')
    } finally {
      setLoading(false)
    }
  }

  const updateStatus = async (status: string) => {
    if (!data || data.quotation.status === status) return
    setUpdatingStatus(true)
    setError('')
    try {
      const result = await api.updateQuotationStatus(quotationId, status)
      const updatedStatus = result?.quotation?.status || status
      setData((current) => {
        if (!current) return current
        return {
          ...current,
          quotation: { ...current.quotation, status: updatedStatus },
        }
      })
    } catch (err) {
      console.error('Failed to update quotation status:', err)
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to update quotation status',
      )
    } finally {
      setUpdatingStatus(false)
    }
  }

  useEffect(() => {
    if (!data?.quotation.company_id) {
      setCompanyName('')
      return
    }
    let cancelled = false
    api
      .listCompanies()
      .then((companies) => {
        if (cancelled) return
        const company = companies.find(
          (item) => item.id === data.quotation.company_id,
        )
        setCompanyName(company?.name || '')
      })
      .catch((err) => {
        console.error('Failed to load quotation company:', err)
        if (!cancelled) setCompanyName('')
      })
    return () => {
      cancelled = true
    }
  }, [data?.quotation.company_id])

  useEffect(() => {
    void loadQuotation()
  }, [quotationId])

  if (loading) {
    return (
      <div className="app">
        <div className="qv-state">Loading quotation…</div>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="app">
        <div className="qv-state qv-state-error">
          <strong>Unable to load quotation</strong>
          <span>{error}</span>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => void loadQuotation()}
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="app">
        <div className="qv-state">Quotation not found</div>
      </div>
    )
  }

  const {
    quotation,
    customer,
    project,
    externalGroups,
    externalParts,
    lines,
    ctlItems,
  } = data

  const normalizedStatus = quotation.status.toLowerCase()
  const statusInfo = getStatusInfo(quotation.status)
  const stockLines = lines.filter((line) => line.line_type === 'stock')
  const shippingLines = lines.filter((line) => line.line_type === 'shipping')
  const includedCtlItems = ctlItems.filter((item) => item.included)
  const itemCount = stockLines.length + externalParts.length

  const totalDue = Number(quotation.total || 0)
  const totalExcVat = Math.round((totalDue / 1.07) * 100) / 100
  const vatAmount = Math.round((totalDue - totalExcVat) * 100) / 100

  return (
    <div className="app">
      <header className="qv-header">
        <div className="qv-header-main">
          <button type="button" className="qv-back" onClick={onBack}>
            ← Quotations
          </button>

          <div className="qv-title-row">
            <div className="qv-title-block">
              <div className="qv-kicker">Quotation</div>
              <h1>{quotation.number}</h1>
              <p className="qv-subtitle">
                {[companyName, customer?.name, project?.name]
                  .filter(Boolean)
                  .join(' · ') || 'No customer'}
              </p>
            </div>

            <span
              className={`qv-badge status-${normalizedStatus}`}
            >
              <span className="qv-badge-dot" />
              {statusInfo.label}
            </span>
          </div>
        </div>

        <div className="qv-header-actions">
          <div className="qv-status-control">
            <label htmlFor="qv-status">Status</label>
            <select
              id="qv-status"
              value={normalizedStatus}
              disabled={updatingStatus}
              onChange={(e) => void updateStatus(e.target.value)}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {updatingStatus && <span className="qv-saving">Saving…</span>}
          </div>

          <button
            type="button"
            className="btn btn-outline"
            onClick={() => void loadQuotation()}
            disabled={loading || updatingStatus}
          >
            Refresh
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onEdit(quotationId)}
          >
            Edit
          </button>
        </div>
      </header>

      <main className="qv-page">
        {error && <div className="qv-inline-error">{error}</div>}

        {/* Meta strip */}
        <section className="qv-meta">
          <div>
            <span>Issue date</span>
            <strong>{formatDate(quotation.issue_date)}</strong>
          </div>
          <div>
            <span>Valid until</span>
            <strong>{formatDate(quotation.valid_until)}</strong>
          </div>
          <div>
            <span>Currency</span>
            <strong>{quotation.currency}</strong>
          </div>
          <div>
            <span>Total due</span>
            <strong className="qv-meta-total">{money(quotation.total)}</strong>
          </div>
        </section>

        {/* Overview */}
        <section className="qv-card">
          <div className="qv-card-head">
            <h2>Overview</h2>
          </div>
          <div className="qv-meta qv-meta-inset">
            <div>
              <span>Customer</span>
              <strong>{customer?.name || '—'}</strong>
            </div>
            <div>
              <span>Project</span>
              <strong>{project?.name || '—'}</strong>
            </div>
            <div>
              <span>Job description</span>
              <strong>{quotation.description || '—'}</strong>
            </div>
            <div>
              <span>Location</span>
              <strong>{quotation.location || '—'}</strong>
            </div>
          </div>
        </section>

        {/* Items */}
        <section className="qv-card">
          <div className="qv-card-head">
            <div>
              <h2>Items</h2>
              <p>
                {itemCount} item{itemCount !== 1 ? 's' : ''}
              </p>
            </div>
            <span className="qv-card-total">
              {money(quotation.parts_subtotal)}
            </span>
          </div>

          {stockLines.length > 0 && (
            <div className="qv-block">
              <div className="qv-block-head">
                <h3>Stock</h3>
                <span>{stockLines.length}</span>
              </div>
              <div className="qv-table-wrap">
                <table className="qv-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Qty</th>
                      <th>Unit</th>
                      <th className="num">Price</th>
                      <th className="num">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stockLines.map((line) => (
                      <tr key={line.id}>
                        <td>
                          <div className="qv-item">
                            <strong>{line.description}</strong>
                            {(line.brand || line.part_no) && (
                              <span>
                                {[line.brand, line.part_no]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </span>
                            )}
                          </div>
                        </td>
                        <td>{Number(line.quantity)}</td>
                        <td>{line.unit || '—'}</td>
                        <td className="num">{money(line.unit_price)}</td>
                        <td className="num">{money(line.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {externalGroups.map((group) => {
            const parts = externalParts
              .filter((part) => part.group_id === group.id)
              .sort((a, b) => a.sort_order - b.sort_order)
            const groupShippingLines = shippingLines.filter(
              (line) => line.external_group_id === group.id,
            )

            return (
              <div className="qv-block" key={group.id}>
                <div className="qv-ext">
                  <div className="qv-ext-head">
                    <div className="qv-ext-title">
                      <span className="qv-pill">External</span>
                      <strong>
                        {group.source_name || 'External supplier'}
                      </strong>
                      {group.country && <span>{group.country}</span>}
                    </div>
                    <div className="qv-ext-meta">
                      {group.estimated_delivery && (
                        <span>Delivery {group.estimated_delivery}</span>
                      )}
                      {group.warranty && <span>Warranty {group.warranty}</span>}
                      {group.installation_included && (
                        <span>Installation included</span>
                      )}
                      {group.currency && <span>{group.currency}</span>}
                      {group.currency && group.currency !== 'THB' && (
                        <span data-testid="external-group-rate">
                          Rate {Number(group.exchange_rate).toFixed(4)}
                          {group.exchange_rate_date &&
                            ` · ${group.exchange_rate_date}`}
                        </span>
                      )}
                    </div>
                  </div>

                  {parts.length > 0 ? (
                    <div className="qv-table-wrap">
                      <table className="qv-table">
                        <thead>
                          <tr>
                            <th>Item</th>
                            <th>Qty</th>
                            <th>Unit</th>
                            <th className="num">Price</th>
                            <th className="num">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {parts.map((part) => (
                            <tr key={part.id}>
                              <td>
                                <strong>{part.part_name}</strong>
                              </td>
                              <td>{Number(part.qty)}</td>
                              <td>{part.unit}</td>
                              <td className="num">{money(part.unit_price)}</td>
                              <td className="num">
                                {money(
                                  Number(part.qty) * Number(part.unit_price),
                                )}
                              </td>
                            </tr>
                          ))}
                          {groupShippingLines.length > 0 && (
                            <tr className="qv-ship-row">
                              <td colSpan={4}>
                                <strong>
                                  {groupShippingLines[0].description}
                                </strong>
                              </td>
                              <td className="num">
                                {money(groupCustomerShipping(group))}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="qv-empty">No external items in this group</div>
                  )}
                </div>
              </div>
            )
          })}

          {stockLines.length === 0 && externalGroups.length === 0 && (
            <div className="qv-empty">No items in this quotation</div>
          )}

          <div className="qv-foot-totals">
            <div>
              <span>Parts</span>
              <strong>{money(quotation.parts_subtotal)}</strong>
            </div>
            <div>
              <span>Shipping</span>
              <strong>{money(quotation.shipping_total)}</strong>
            </div>
            <div>
              <span>Import tax</span>
              <strong>{money(quotation.import_tax_total)}</strong>
            </div>
          </div>
        </section>

        {/* CTL */}
        <section className="qv-card">
          <div className="qv-card-head">
            <div>
              <h2>CTL</h2>
              <p>Consumables, transport, labour</p>
            </div>
            <span className="qv-card-total">{money(quotation.ctl_total)}</span>
          </div>

          {includedCtlItems.length > 0 ? (
            <div className="qv-table-wrap">
              <table className="qv-table">
                <thead>
                  <tr>
                    <th>Cost item</th>
                    <th className="num">Price</th>
                    <th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {includedCtlItems.map((item) => (
                    <tr key={item.key}>
                      <td>
                        <div className="qv-item">
                          <strong>{item.label}</strong>
                          {item.note && <span>{item.note}</span>}
                          {item.key === 'labour' && (
                            <span>
                              {item.days} day{item.days > 1 ? 's' : ''},{' '}
                              {item.technicians} technician
                              {item.technicians > 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="num">{money(item.price)}</td>
                      <td className="num">
                        {money(computeCtlTotal(item.price))}
                      </td>
                    </tr>
                  ))}
                  <tr className="qv-total-row">
                    <td colSpan={2} className="num">
                      <strong>CTL total</strong>
                    </td>
                    <td className="num">
                      <strong>{money(quotation.ctl_total)}</strong>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <div className="qv-empty">No CTL costs</div>
          )}
        </section>

        {quotation.notes && (
          <section className="qv-card">
            <div className="qv-card-head">
              <h2>Notes</h2>
            </div>
            <div className="qv-notes">{quotation.notes}</div>
          </section>
        )}

        {/* Summary */}
        <section className="qv-summary-wrap">
          <div className="qv-summary">
            <div className="qv-summary-head">Financial summary</div>

            <div className="qv-summary-row">
              <span>Parts subtotal</span>
              <strong>{money(quotation.parts_subtotal)}</strong>
            </div>
            <div className="qv-summary-row">
              <span>
                Discount
                {Number(quotation.discount_value) > 0 && (
                  <small> ({Number(quotation.discount_value)}%)</small>
                )}
              </span>
              <strong>-{money(quotation.discount_amount)}</strong>
            </div>
            <div className="qv-summary-row">
              <span>Shipping</span>
              <strong>{money(quotation.shipping_total)}</strong>
            </div>
            <div className="qv-summary-row">
              <span>Import tax</span>
              <strong>{money(quotation.import_tax_total)}</strong>
            </div>
            <div className="qv-summary-row">
              <span>CTL</span>
              <strong>{money(quotation.ctl_total)}</strong>
            </div>
            <div className="qv-summary-row" data-testid="view-total-exc-vat">
              <span>Total excl. VAT</span>
              <strong>{money(totalExcVat)}</strong>
            </div>
            <div className="qv-summary-row" data-testid="view-vat-7">
              <span>VAT 7%</span>
              <strong>{money(vatAmount)}</strong>
            </div>
            <div className="qv-summary-divider" />
            <div className="qv-summary-row qv-grand">
              <span>Total due</span>
              <strong>{money(quotation.total)}</strong>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}

export default QuotationView