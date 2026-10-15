import { useEffect, useState } from 'react'
import {
  generateQuotationPDF,
  CTL_ITEM_DEFS,
  computeCtlTotal,
  type CtlItemKey,
} from './utils/generateQuotationPDF'
import './index.css'
import StockItemPicker from './components/StockItemPicker'
import type { InventoryItem } from './types/inventory'
import ExternalPartForm from './components/ExternalPartForm'
import type { Project, WorkOrder } from './types/QuoteItem'

type QuoteItem = {
  id: string
  source: 'stock' | 'external'
  brand: string
  partName: string
  partNo: string
  qty: number
  unit: string
  unitPrice: number
  sourceType?: 'import' | 'local_supplier' | 'local_purchase'
  sourceName?: string
  shippingIncluded?: boolean
  estimatedDelivery?: string
  importDutyIncluded?: boolean
  customsClearanceIncluded?: boolean
  additionalTransportIncluded?: boolean
  installationIncluded?: boolean
  warranty?: string
}

function App() {
  const [items, setItems] = useState<QuoteItem[]>([])
  const [stockPickerOpen, setStockPickerOpen] = useState(false)
  const [externalFormOpen, setExternalFormOpen] = useState(false)
  const [discountPercent, setDiscountPercent] = useState(0)
  const [importTax, setImportTax] = useState(0)
  const [customerName, setCustomerName] = useState('')
  const [jobDescription, setJobDescription] = useState('')
  const [quotationDate, setQuotationDate] = useState(
    new Date().toISOString().split('T')[0]
  )
  const [projects, setProjects] = useState<Project[]>([])
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [selectedWorkOrderId, setSelectedWorkOrderId] = useState('')

  // CTL costs are fixed line items — wording never changes, we only pick
  // which ones apply, the price, and (for two of them) a note. Labour gets
  // a structured day-by-day breakdown instead of a plain free-text note.
  type CtlRowState = {
    included: boolean
    price: number
    note: string
    days: number
    technicians: number
    dayDescriptions: string[]
  }
  const [ctlState, setCtlState] = useState<Record<CtlItemKey, CtlRowState>>(
    () =>
      Object.fromEntries(
        CTL_ITEM_DEFS.map((def) => [
          def.key,
          {
            included: false,
            price: 0,
            note: '',
            days: 1,
            technicians: 1,
            dayDescriptions: [''],
          },
        ])
      ) as Record<CtlItemKey, CtlRowState>
  )

  const updateCtlRow = (
    key: CtlItemKey,
    patch: Partial<CtlRowState>
  ) => {
    setCtlState((current) => ({
      ...current,
      [key]: { ...current[key], ...patch },
    }))
  }

  // Resize the labour day-description list to match the day count, keeping
  // whatever was already typed for the days that still exist.
  const setLabourDays = (days: number) => {
    setCtlState((current) => {
      const clampedDays = Math.max(1, days)
      const currentDescriptions = current.labour.dayDescriptions
      const dayDescriptions = Array.from(
        { length: clampedDays },
        (_, index) => currentDescriptions[index] ?? ''
      )
      return {
        ...current,
        labour: { ...current.labour, days: clampedDays, dayDescriptions },
      }
    })
  }

  const setLabourDayDescription = (dayIndex: number, description: string) => {
    setCtlState((current) => {
      const dayDescriptions = [...current.labour.dayDescriptions]
      dayDescriptions[dayIndex] = description
      return {
        ...current,
        labour: { ...current.labour, dayDescriptions },
      }
    })
  }

  const ctlItemsForPdf = CTL_ITEM_DEFS.filter(
    (def) => ctlState[def.key].included
  ).map((def) => {
    const row = ctlState[def.key]

    let note: string | undefined
    if (def.key === 'labour') {
      const dayLines = row.dayDescriptions
        .map((description, index) => `Day ${index + 1}: ${description}`.trim())
        .filter((line, index) => line !== `Day ${index + 1}:`)
      note = [
        `${row.days} Day / ${row.technicians} Technicians:`,
        ...dayLines,
      ].join('\n')
    } else if (def.hasNote) {
      note = row.note || undefined
    }

    return {
      label: def.label,
      price: row.price,
      total: computeCtlTotal(row.price),
      note,
    }
  })

  const ctlTotal = ctlItemsForPdf.reduce((sum, item) => sum + item.total, 0)

  const validUntil = (() => {
    const date = new Date(`${quotationDate}T00:00:00`)
    date.setMonth(date.getMonth() + 1)
    return date.toISOString().split('T')[0]
  })()

  useEffect(() => {
    fetch('http://localhost:4500/api/inventory/quotations/projects')
      .then((response) => {
        if (!response.ok) {
          throw new Error('Failed to load projects')
        }
        return response.json()
      })
      .then(setProjects)
      .catch((error) => {
        console.error('Failed to load projects:', error)
      })
  }, [])

  useEffect(() => {
    if (!selectedProjectId) {
      setWorkOrders([])
      setSelectedWorkOrderId('')
      return
    }

    fetch(
      `http://localhost:4500/api/inventory/quotations/projects/${selectedProjectId}/work-orders`
    )
      .then((response) => {
        if (!response.ok) {
          throw new Error('Failed to load work orders')
        }
        return response.json()
      })
      .then(setWorkOrders)
      .catch((error) => {
        console.error('Failed to load work orders:', error)
        setWorkOrders([])
      })
  }, [selectedProjectId])

  const subtotal = items.reduce(
    (sum, item) => sum + item.qty * item.unitPrice,
    0
  )

  // Discount only applies to the parts/items portion, not CTL or import tax.
  const discountAmount = subtotal * (discountPercent / 100)

  // "Total" = items + import tax + CTL cost — all VAT-inclusive already.
  const totalWithTax = subtotal + importTax + ctlTotal

  // Total Due = Total - Discount (still VAT-inclusive); Exc.VAT / VAT are
  // just the backward-out breakdown of that figure, not additive on top.
  const totalDue = totalWithTax - discountAmount
  const totalExcVat = totalDue / 1.07
  const vat = totalDue - totalExcVat

  const addExternalPart = () => {
    setExternalFormOpen(true)
  }

  const handleStockSelect = (item: InventoryItem) => {
    setItems((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        source: 'stock',
        brand: item.brand || '',
        partName: item.partName,
        partNo: item.partNo || '',
        qty: 1,
        unit: item.unit?.abbreviation || item.unit?.name || 'ea',
        unitPrice: Number(item.unitSellPrice),
      },
    ])

    setStockPickerOpen(false)
  }

  const handleExternalSubmit = (part: {
    brand: string
    partName: string
    partNo: string
    qty: number
    unit: string
    unitPrice: number
    sourceType: 'import' | 'local_supplier' | 'local_purchase'
    sourceName: string
    shippingIncluded: boolean
    estimatedDelivery: string
    importDutyIncluded: boolean
    customsClearanceIncluded: boolean
    additionalTransportIncluded: boolean
    installationIncluded: boolean
    warranty: string
  }) => {
    setItems((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        source: 'external',
        ...part,
      },
    ])

    setExternalFormOpen(false)
  }

  const externalItems = items.filter(
    (item) => item.source === 'external'
  )

  const quotationNotes = externalItems.map((item) => {
    const productName = [
      item.brand,
      item.partName,
    ]
      .filter(Boolean)
      .join(' ')

    const includedCosts: string[] = []
    const excludedCosts: string[] = []

    if (item.shippingIncluded) {
      includedCosts.push('shipping cost')
    } else {
      excludedCosts.push('shipping cost')
    }

    if (item.sourceType === 'import') {
      if (item.importDutyIncluded) {
        includedCosts.push('import duty')
      } else {
        excludedCosts.push('import duty')
      }

      if (item.customsClearanceIncluded) {
        includedCosts.push('customs clearance')
      } else {
        excludedCosts.push('customs clearance')
      }
    }

    if (item.additionalTransportIncluded) {
      includedCosts.push('additional transport')
    } else {
      excludedCosts.push('additional transport')
    }

    if (item.installationIncluded) {
      includedCosts.push('installation')
    } else {
      excludedCosts.push('installation')
    }

    let note = `This quotation covers only the purchase of ${productName}.`

    if (includedCosts.length > 0) {
      note += ` It includes ${includedCosts.join(', ')}.`
    }

    if (excludedCosts.length > 0) {
      note += ` It excludes ${excludedCosts.join(', ')}.`
    }

    if (item.estimatedDelivery) {
      note += ` Estimated delivery time is ${item.estimatedDelivery}.`
    }

    if (item.warranty) {
      note += ` Warranty is subject to ${item.warranty}.`
    }

    note +=
      ' Any additional costs, labor, or spare parts beyond this quotation will be charged separately.'

    return {
      product: productName,
      note,
    }
  })

  const removeItem = (id: string) => {
    setItems((current) =>
      current.filter((item) => item.id !== id)
    )
  }

  const updateItemQty = (id: string, qty: number) => {
    setItems((current) =>
      current.map((item) =>
        item.id === id
          ? { ...item, qty: Math.max(1, qty) }
          : item
      )
    )
  }

  const saveQuotation = () => {
    const selectedProject = projects.find(
      (project) => project.id === selectedProjectId
    )

    const selectedWorkOrder = workOrders.find(
      (workOrder) => workOrder.id === selectedWorkOrderId
    )

    const quotation = {
      quotationDate,
      quotationNo: 'DRAFT',
      customerName: selectedWorkOrder?.project?.client?.name || '',
      projectName: selectedWorkOrder?.project?.name || '',
      workOrderNumber: selectedWorkOrder?.number || '',
      jobDescription: selectedWorkOrder?.title || '',
      validUntil,
      items,
      ctlItems: ctlItemsForPdf,
      discountPercent,
      importTax,
    }

    fetch('http://localhost:4500/api/inventory/quotations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(quotation),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error('Failed to save quotation')
        }
        return response.json()
      })
      .then((data) => {
        console.log('Quotation saved:', data)
      })
      .catch((error) => {
        console.error('Failed to save quotation:', error)
      })
  }

  const exportPDF = async () => {
    const selectedProject = projects.find(
      (project) => project.id === selectedProjectId
    )

    const selectedWorkOrder = workOrders.find(
      (workOrder) => workOrder.id === selectedWorkOrderId
    )

    await generateQuotationPDF({
      quotationDate,
      quotationNo: 'DRAFT',
      customerName: selectedWorkOrder?.project?.client?.name || '',
      projectName: selectedWorkOrder?.project?.name || '',
      workOrderNumber: selectedWorkOrder?.number || '',
      jobDescription: selectedWorkOrder?.title || '',
      validUntil,
      items,
      ctlItems: ctlItemsForPdf,
      discountPercent,
      importTax,
    })
  }

  return (
    <div className="app">
      <header className="page-header">
        <div>
          <h1>Quotation</h1>
          <p>Create and manage customer quotations</p>
        </div>

        {/* <button className="btn btn-primary">
            Save Quotation
          </button> */}
        <button
          className="btn btn-primary"
          onClick={exportPDF}
        >
          Export PDF
        </button>
      </header>

      <main className="quotation-page">
        <section className="card">
          <div className="section-header">
            <h2>Quotation Information</h2>
          </div>

          <div className="form-grid">
            <div className="form-group">
              <label>Quotation No.</label>
              <input
                type="text"
                placeholder="Auto generated"
                disabled
              />
            </div>

            <div className="form-group">
              <label>Quotation Date</label>
              <input
                type="date"
                value={quotationDate}
                onChange={(event) => setQuotationDate(event.target.value)}
              />
            </div>

            <div className="form-group form-group-wide">
              <label>Customer</label>
              <input
                type="text"
                // ให้โชว์ชื่อจากข้อมูล Work order ที่เลือก หรือแสดงค่าว่างถ้ายังไม่เลือก
                value={workOrders.find(wo => wo.id === selectedWorkOrderId)?.project?.client?.name || ''}
                placeholder="Auto-filled from selected project"
                disabled // ล็อกช่องนี้ไว้เหมือนช่อง Quotation No.
              />
            </div>

            <div className="form-group">
              <label>Project</label>
              <select
                value={selectedProjectId}
                onChange={(event) => setSelectedProjectId(event.target.value)}
              >
                <option value="">Select project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Work Order</label>
              <select
                value={selectedWorkOrderId}
                onChange={(event) => setSelectedWorkOrderId(event.target.value)}
                disabled={!selectedProjectId}
              >
                <option value="">
                  {selectedProjectId
                    ? 'Select work order'
                    : 'Select project first'}
                </option>

                {workOrders.map((workOrder) => (
                  <option key={workOrder.id} value={workOrder.id}>
                    {workOrder.number} — {workOrder.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Valid Until</label>
              <input
                type="date"
                value={validUntil}
                readOnly
              />
            </div>
          </div>
        </section>

        <section className="card">
          <div className="section-header">
            <div>
              <h2>Quotation Items</h2>
              <p>Add parts from stock or external parts</p>
            </div>

            <div className="item-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setStockPickerOpen(true)}
              >
                + Add from Stock
              </button>

              <button
                className="btn btn-outline"
                onClick={addExternalPart}
              >
                + Add External Part
              </button>
            </div>
          </div>

          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Part Needed</th>
                  <th>Source</th>
                  <th>Part No.</th>
                  <th>Qty</th>
                  <th>Unit</th>
                  <th>Price / Unit</th>
                  <th>Total</th>
                  <th></th>
                </tr>
              </thead>

              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="empty-state"
                    >
                      No items added yet
                    </td>
                  </tr>
                ) : (
                  items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <div className="part-name">
                          {item.brand || '—'}
                        </div>

                        <div className="part-description">
                          {item.partName || 'External part'}
                        </div>
                      </td>

                      <td>
                        <span
                          className={`source-badge ${item.source}`}
                        >
                          {item.source === 'stock'
                            ? 'Stock'
                            : 'External'}
                        </span>
                      </td>

                      <td>
                        {item.partNo || '—'}
                      </td>

                      <td>
                        <input
                          className="table-input small number-input"
                          type="number"
                          min="1"
                          value={item.qty}
                          onChange={(event) =>
                            updateItemQty(
                              item.id,
                              Number(event.target.value)
                            )
                          }
                        />
                      </td>

                      <td>
                        {item.unit}
                      </td>

                      <td className="number">
                        {item.unitPrice.toFixed(2)}
                      </td>

                      <td className="number">
                        {(
                          item.qty * item.unitPrice
                        ).toFixed(2)}
                      </td>

                      <td>
                        <button
                          className="remove-btn"
                          onClick={() =>
                            removeItem(item.id)
                          }
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="section-header">
            <div>
              <h2>Consumables / Transportation / Labor Cost (CTL Cost)</h2>
              <p>Fixed cost lines — tick to include, then set the price</p>
            </div>
          </div>

          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Cost Item</th>
                  <th>Price / unit</th>
                  <th>Total (incl. 7%)</th>
                </tr>
              </thead>
              <tbody>
                {CTL_ITEM_DEFS.map((def) => {
                  const row = ctlState[def.key]
                  return (
                    <>
                      <tr key={def.key}>
                        <td className="ctl-checkbox-cell">
                          <input
                            type="checkbox"
                            checked={row.included}
                            onChange={(event) =>
                              updateCtlRow(def.key, {
                                included: event.target.checked,
                              })
                            }
                          />
                        </td>
                        <td className={`ctl-label${row.included ? ' included' : ''}`}>
                          {def.label}
                        </td>
                        <td>
                          <input
                            className="table-input small number-input"
                            type="number"
                            min="0"
                            step="0.01"
                            disabled={!row.included}
                            value={row.price}
                            onChange={(event) =>
                              updateCtlRow(def.key, {
                                price: Math.max(0, Number(event.target.value)),
                              })
                            }
                          />
                        </td>
                        <td className="number">
                          {row.included
                            ? computeCtlTotal(row.price).toFixed(2)
                            : '—'}
                        </td>
                      </tr>
                      {def.key === 'labour' && row.included && (
                        <tr key={`${def.key}-labour-detail`}>
                          <td></td>
                          <td colSpan={3} style={{ padding: 0 }}>
                            <div className="labour-panel">
                              <div className="labour-fields">
                                <label>
                                  Days
                                  <input
                                    className="table-input small number-input"
                                    type="number"
                                    min="1"
                                    value={row.days}
                                    onChange={(event) =>
                                      setLabourDays(Number(event.target.value))
                                    }
                                  />
                                </label>
                                <label>
                                  Technicians
                                  <input
                                    className="table-input small number-input"
                                    type="number"
                                    min="1"
                                    value={row.technicians}
                                    onChange={(event) =>
                                      updateCtlRow('labour', {
                                        technicians: Math.max(
                                          1,
                                          Number(event.target.value)
                                        ),
                                      })
                                    }
                                  />
                                </label>
                                <span className="labour-summary">
                                  {row.days} day{row.days > 1 ? 's' : ''},{' '}
                                  {row.technicians} technician
                                  {row.technicians > 1 ? 's' : ''}
                                </span>
                              </div>

                              <div className="labour-days">
                                {row.dayDescriptions.map((description, dayIndex) => (
                                  <div className="day-row" key={dayIndex}>
                                    <span className="day-badge">{dayIndex + 1}</span>
                                    <input
                                      className="table-input"
                                      type="text"
                                      placeholder={`Day ${dayIndex + 1}: what was done that day`}
                                      value={description}
                                      onChange={(event) =>
                                        setLabourDayDescription(
                                          dayIndex,
                                          event.target.value
                                        )
                                      }
                                    />
                                  </div>
                                ))}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                      {def.hasNote && def.key !== 'labour' && row.included && (
                        <tr key={`${def.key}-note`}>
                          <td></td>
                          <td colSpan={3} style={{ padding: 0 }}>
                            <div className="note-panel">
                              <input
                                className="table-input"
                                type="text"
                                placeholder={def.notePlaceholder}
                                value={row.note}
                                onChange={(event) =>
                                  updateCtlRow(def.key, {
                                    note: event.target.value,
                                  })
                                }
                              />
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
                <tr>
                  <td></td>
                  <td className="number" colSpan={2} style={{ textAlign: 'right' }}>
                    CTL Total
                  </td>
                  <td className="number">
                    <strong>{ctlTotal.toFixed(2)}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <div className="summary-layout">
          <section className="quotation-notes-preview">
            <div className="section-header">
              <div>
                <h2>Quotation Notes</h2>
                <p>Preview of terms shown to the customer</p>
              </div>
            </div>

            <div className="quotation-notes-content">
              {quotationNotes.length === 0 ? (
                <div className="quotation-note">
                  Add an external part to generate quotation notes automatically.
                </div>
              ) : (
                quotationNotes.map((item, index) => (
                  <div className="quotation-note" key={index}>
                    <div className="quotation-note-product">
                      {item.product}
                    </div>

                    <div className="quotation-note-text">
                      {item.note}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="summary-card">
            <div className="summary-row">
              <span>Subtotal</span>
              <strong>฿ {subtotal.toFixed(2)}</strong>
            </div>

            <div className="summary-row">
              <span>Discount</span>

              <div className="summary-input-group">
                <input
                  className="summary-input"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={discountPercent}
                  onChange={(event) =>
                    setDiscountPercent(
                      Math.min(
                        100,
                        Math.max(0, Number(event.target.value))
                      )
                    )
                  }
                />
                <span>%</span>
              </div>
            </div>

            <div className="summary-row">
              <span>Discount Amount</span>
              <strong className="discount-value">
                -฿ {discountAmount.toFixed(2)}
              </strong>
            </div>

            <div className="summary-row">
              <span>Estimate Import Tax</span>

              <div className="summary-input-group">
                <span>฿</span>
                <input
                  className="summary-input amount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={importTax}
                  onChange={(event) =>
                    setImportTax(
                      Math.max(0, Number(event.target.value))
                    )
                  }
                />
              </div>
            </div>

            <div className="summary-row">
              <span>CTL Cost</span>
              <strong>฿ {ctlTotal.toFixed(2)}</strong>
            </div>

            <div className="summary-row">
              <span>Total Exc. VAT</span>
              <strong>฿ {totalExcVat.toFixed(2)}</strong>
            </div>

            <div className="summary-row">
              <span>VAT 7%</span>
              <strong>฿ {vat.toFixed(2)}</strong>
            </div>

            <div className="summary-divider" />

            <div className="summary-row grand-total">
              <span>Total Due</span>
              <strong>฿ {totalDue.toFixed(2)}</strong>
            </div>
          </section>
        </div>

        <section className="card">
          <div className="form-group">
            <label>Notes</label>

            <textarea
              rows={4}
              placeholder="Additional notes for this quotation..."
            />
          </div>
        </section>
      </main>
      <StockItemPicker
        open={stockPickerOpen}
        onClose={() => setStockPickerOpen(false)}
        onSelect={handleStockSelect}
      />

      <ExternalPartForm
        open={externalFormOpen}
        onClose={() => setExternalFormOpen(false)}
        onSubmit={handleExternalSubmit}
      />
    </div>

  )
}

export default App