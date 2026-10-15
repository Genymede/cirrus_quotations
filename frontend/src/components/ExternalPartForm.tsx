import { useState, useEffect, useMemo, useCallback, useRef, type FormEvent } from 'react'
import {
  createId,
  createEmptyExternalPart,
  calculateSellingPrice,
  computeShippingAllocation,
  customerShippingForQuotation,
  validateExternalGroup,
  clearStockAllocation,
  CURRENCY_CONFIG,
  lotShipping,
  VAT_RATE,
  type SourceType,
  type ExternalPart,
  type ExternalGroup,
  type ValidationError,
  type DeliveryUnit,
  type CurrencyCode,
} from '../utils/externalPartsAllocation'
import { api } from '../services/api'
import {
  bangkokToday,
  fetchExchangeRates,
  resolveRate,
  normalizeCurrencyCode,
  DEFAULT_CURRENCY_BUFFER,
  type ExchangeRateEntry,
} from '../services/exchangeRate'
export type { ExternalPart, ExternalGroup }
type Unit = {
  id: string
  name: string
  abbreviation: string
  isActive: boolean
  createdAt: string
}
type Props = {
  open: boolean
  onClose: () => void
  onSubmit: (group: ExternalGroup) => void
  initialGroup?: ExternalGroup | null
  focusPartId?: string | null
}
const DEFAULT_MARKUP = 54
const DEFAULT_WARRANTY: Record<SourceType, string> = {
  import: "Manufacturer's Terms",
  local_supplier: "Supplier's Terms",
  local_purchase: '',
}
const CURRENCY_OPTIONS: { code: CurrencyCode; label: string }[] = [
  { code: 'THB', label: 'THB : Thai Baht' },
  { code: 'EUR', label: 'EUR : Euro' },
  { code: 'USD', label: 'USD : US Dollar' },
  { code: 'SGD', label: 'SGD : Singapore Dollar' },
  { code: 'AUD', label: 'AUD : Australian Dollar' },
  { code: 'GBP', label: 'GBP : British Pound' },
]
const RATE_TYPE_LABELS: Record<string, string> = {
  sellNotes: 'Notes sell',
}
const IMPORT_TAX_OPTIONS = [0, 10, 15, 20, 30, 35]
function roundDecimal(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round((Number(value) || 0) * factor + Number.EPSILON) / factor
}
function moneyToCents(value: number): number {
  return Math.round((Number(value) || 0) * 100)
}
function centsToMoney(cents: number): number {
  return cents / 100
}
function toTHB(amount: number, rate: number): number {
  return (Number(amount) || 0) * (Number(rate) || 0)
}
// Reverse of the buffer: raw rate such that raw * (1 + buffer/100) = appliedRate
function actualFromApplied(appliedRate: number, bufferPercent: number): number {
  const multiplier = 1 + (Number(bufferPercent) || 0) / 100
  return multiplier > 0 ? appliedRate / multiplier : appliedRate
}
const RATE_DECIMALS = 6
function applyBuffer(rawRate: number, bufferPercent: number): number {
  return roundDecimal(rawRate * (1 + (Number(bufferPercent) || 0) / 100), RATE_DECIMALS)
}
function calculateShippingVat(shippingCost: number): number {
  const shippingCents = moneyToCents(roundDecimal(shippingCost, 6))
  return centsToMoney(Math.round(shippingCents * 7 / 100))
}
function calculateShippingTotal(shippingCost: number): number {
  const shippingCents = moneyToCents(roundDecimal(shippingCost, 6))
  const vatCents = Math.round(shippingCents * 7 / 100)
  return centsToMoney(shippingCents + vatCents)
}
function createEmptyPart(rate = 1, currency: CurrencyCode = 'THB'): ExternalPart {
  const unitCost = 0
  const unitCostTHB = toTHB(unitCost, rate)
  return createEmptyExternalPart({
    markupPercent: DEFAULT_MARKUP,
    unitCost,
    unitCostTHB,
    unitPrice: calculateSellingPrice(unitCostTHB, DEFAULT_MARKUP, currency),
  })
}
export default function ExternalPartForm({
  open,
  onClose,
  onSubmit,
  initialGroup,
  focusPartId,
}: Props) {
  const [sourceType, setSourceType] = useState<SourceType>('import')
  const [sourceName, setSourceName] = useState('')
  const [country, setCountry] = useState('')
  const [parts, setParts] = useState<ExternalPart[]>([])
  const [shippingCost, setShippingCost] = useState(0) // THB, before VAT
  const [shippingCostFc, setShippingCostFc] = useState(0) // Original currency, before VAT
  // const [importTax, setImportTax] = useState(0)
  const [estimatedDeliveryValue, setEstimatedDeliveryValue] = useState(0)
  const [estimatedDeliveryUnit, setEstimatedDeliveryUnit] = useState<DeliveryUnit>('weeks')
  const [warranty, setWarranty] = useState(DEFAULT_WARRANTY.import)
  const [installationIncluded, setInstallationIncluded] = useState(false)
  const [units, setUnits] = useState<Unit[]>([])
  const [unitsLoading, setUnitsLoading] = useState(false)
  const [containsStockItems, setContainsStockItems] = useState(false)
  const [pendingFocusPartId, setPendingFocusPartId] = useState<string | null>(null)
  const [touchedFields, setTouchedFields] = useState<Set<string>>(new Set())
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const [brand, setBrand] = useState('')
  const [currency, setCurrency] = useState<CurrencyCode>('THB')
  // Applied exchange rate (raw + buffer). Used for every calculation and stored as exchange_rate.
  const [exchangeRate, setExchangeRate] = useState<number | null>(1)
  // Raw exchange rate before buffer. Not displayed; stored as actual_exchange_rate and
  // used as the base when the buffer is changed (including when editing an existing record).
  const [actualExchangeRate, setActualExchangeRate] = useState<number | null>(1)
  const [rateDate, setRateDate] = useState<string>(bangkokToday)
  const [rateSource, setRateSource] = useState<'unset' | 'bank' | 'manual' | 'loaded'>('unset')
  const [rateLoading, setRateLoading] = useState(false)
  const [rateError, setRateError] = useState('')
  const [rateEntry, setRateEntry] = useState<ExchangeRateEntry | null>(null)
  const [rateNotFoundFor, setRateNotFoundFor] = useState<{ currency: string; date: string } | null>(null)
  const [bufferPercent, setBufferPercent] = useState(DEFAULT_CURRENCY_BUFFER)

  const rateRequestRef = useRef(0)
  const showForeignCost = currency !== 'THB'
  useEffect(() => {
    if (!open) return
    const loadUnits = async () => {
      try {
        setUnitsLoading(true)
        const data = await api.listUnits()
        const activeUnits = Array.isArray(data)
          ? (data as Unit[]).filter((unit) => unit.isActive)
          : []
        setUnits(activeUnits)
        if (activeUnits.length > 0) {
          setParts((prev) =>
            prev.map((part) =>
              part.unit ? part : { ...part, unit: activeUnits[0].abbreviation }
            )
          )
        }
      } catch (error) {
        console.error('Failed to load units:', error)
        setUnits([])
      } finally {
        setUnitsLoading(false)
      }
    }
    loadUnits()
  }, [open])
  useEffect(() => {
    if (!open) return
    setTouchedFields(new Set())
    setSubmitAttempted(false)
    setRateDate(bangkokToday())
    setRateError('')
    setRateEntry(null)
    setRateNotFoundFor(null)
    if (initialGroup) {
      const loadedBuffer = initialGroup.bufferPercent ?? DEFAULT_CURRENCY_BUFFER
      setBufferPercent(loadedBuffer)
      setSourceType(initialGroup.sourceType)
      setSourceName(initialGroup.sourceName)
      setBrand(initialGroup.brand ?? '')
      setCountry(initialGroup.country)
      setParts(initialGroup.parts)
      const loadedCurrency = initialGroup.currency ?? 'THB'
      const loadedRate = initialGroup.exchangeRate ?? 1
      setCurrency(loadedCurrency)
      setExchangeRate(loadedRate)
      // Base for recalculation: the stored raw rate. Records saved before
      // actual_exchange_rate existed fall back to un-buffering the stored rate.
      setActualExchangeRate(
        loadedCurrency === 'THB'
          ? 1
          : initialGroup.actualExchangeRate != null && initialGroup.actualExchangeRate > 0
            ? initialGroup.actualExchangeRate
            : actualFromApplied(loadedRate, loadedBuffer)
      )
      setShippingCost(initialGroup.shippingCost)
      setShippingCostFc(
        initialGroup.shippingCostFc ??
        (loadedCurrency === 'THB'
          ? initialGroup.shippingCost
          : loadedRate > 0
            ? initialGroup.shippingCost / loadedRate
            : 0)
      )
      setRateSource(initialGroup.currency && initialGroup.currency !== 'THB' ? 'loaded' : 'unset')
      setRateDate(initialGroup.exchangeRateDate || bangkokToday())
      const deliveryMatch = initialGroup.estimatedDelivery.match(/^(\d+)\s+(\w+)$/)
      setEstimatedDeliveryValue(deliveryMatch ? Number(deliveryMatch[1]) : 0)
      setEstimatedDeliveryUnit(
        deliveryMatch ? (deliveryMatch[2] as DeliveryUnit) : 'weeks'
      )
      setWarranty(initialGroup.warranty)
      setInstallationIncluded(initialGroup.installationIncluded)
      setContainsStockItems(initialGroup.containsStockItems)
      setPendingFocusPartId(focusPartId ?? null)
    } else {
      setBufferPercent(DEFAULT_CURRENCY_BUFFER)
      setSourceType('import')
      setSourceName('')
      setBrand('')
      setCountry('')
      setParts([])
      setShippingCost(0)
      setShippingCostFc(0)
      setCurrency('THB')
      setExchangeRate(1)
      setActualExchangeRate(1)
      setRateSource('unset')
      setEstimatedDeliveryValue(0)
      setEstimatedDeliveryUnit('weeks')
      setWarranty(DEFAULT_WARRANTY.import)
      setInstallationIncluded(false)
      setContainsStockItems(false)
      setPendingFocusPartId(null)
    }
  }, [open, initialGroup, focusPartId])
  useEffect(() => {
    setParts((prev) =>
      prev.map((part) => {
        const unitCostTHB = toTHB(part.unitCost, exchangeRate ?? 0)
        return {
          ...part,
          unitCostTHB,
          unitPrice: calculateSellingPrice(unitCostTHB, part.markupPercent, currency),
        }
      })
    )
  }, [exchangeRate, currency])
  useEffect(() => {
    const rate = currency === 'THB' ? 1 : exchangeRate ?? 0
    setShippingCost(roundDecimal(toTHB(shippingCostFc, rate), 3))
  }, [shippingCostFc, exchangeRate, currency])
  useEffect(() => {
    if (!pendingFocusPartId) return
    if (!parts.some((part) => part.id === pendingFocusPartId)) return
    const rowEl = document.getElementById(`external-part-row-${pendingFocusPartId}`)
    const inputEl = document.getElementById(`external-part-name-${pendingFocusPartId}`)
    rowEl?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      ; (inputEl as HTMLInputElement | null)?.focus()
    setPendingFocusPartId(null)
  }, [parts, pendingFocusPartId])
  const partsSubtotal = useMemo(
    () =>
      parts.reduce((sum, part) => {
        const quotationQty = part.hasStockPortion
          ? Math.max(0, part.qty - part.stockQty)
          : part.qty
        const lineTotalCents = moneyToCents(part.unitPrice) * quotationQty
        return sum + centsToMoney(lineTotalCents)
      }, 0),
    [parts]
  )
  const calculatedImportTax = useMemo(() => {
    if (sourceType !== 'import') return 0
    return roundDecimal(
      parts.reduce((sum, part) => {
        const quotationQty = part.hasStockPortion
          ? Math.max(0, part.qty - part.stockQty)
          : part.qty
        const lineTotal = centsToMoney(moneyToCents(part.unitPrice) * quotationQty)
        return sum + roundDecimal(lineTotal * (part.importTaxPercent ?? 0) / 100, 3)
      }, 0),
      3
    )
  }, [parts, sourceType])
  const shippingVat = useMemo(
    () => calculateShippingVat(shippingCost),
    [shippingCost]
  )
  const shippingTotal = useMemo(
    () => calculateShippingTotal(shippingCost),
    [shippingCost]
  )
  // const groupTotal = useMemo(
  //   () => roundDecimal(partsSubtotal + shippingTotal + importTax, 6),
  //   [partsSubtotal, shippingTotal, importTax]
  // )
  const onQuotationShipping = useMemo(
    () =>
      customerShippingForQuotation({
        parts,
        shippingCost,
        containsStockItems,
        currency,
        exchangeRate: exchangeRate ?? 0,
        shippingCostFc,
        transferFee: null,
      }),
    [parts, shippingCost, shippingCostFc, containsStockItems, currency, exchangeRate]
  )
  const onQuotationImportTax = calculatedImportTax
  const groupTotal = useMemo(
    () => roundDecimal(partsSubtotal + onQuotationShipping + calculatedImportTax, 3),
    [partsSubtotal, onQuotationShipping, calculatedImportTax]
  )
  const shippingAllocation = useMemo(
    () => computeShippingAllocation({ parts, shippingCost, containsStockItems }),
    [parts, shippingCost, containsStockItems]
  )
  const boxWeight = shippingAllocation.totalWeight
  const stockWeight = shippingAllocation.stockWeight
  const shippingBreakdown = useMemo(
    () =>
      lotShipping({
        shippingCostFc,
        rate: currency === 'THB' ? 1 : exchangeRate ?? 0,
        currency,
        transferFee: null,
      }),
    [shippingCostFc, exchangeRate, currency]
  )
  const shippingBeforeRounding = roundDecimal(
    shippingBreakdown.shippingThb * (1 + VAT_RATE) +
    (shippingBreakdown.transferFeeApplied ?? 0),
    3
  )
  const shippingRoundingAdjustment = roundDecimal(
    shippingBreakdown.customerShipping - shippingBeforeRounding,
    3
  )
  const validationErrors = useMemo<ValidationError[]>(
    () =>
      validateExternalGroup({
        id: '',
        sourceType,
        sourceName,
        brand,
        country,
        parts,
        shippingCost,
        importTax: calculatedImportTax,
        estimatedDelivery: '',
        warranty,
        installationIncluded,
        containsStockItems,
        currency,
        exchangeRate: exchangeRate ?? 0,
        actualExchangeRate: actualExchangeRate ?? 0,
        exchangeRateDate: null,
        shippingCostFc,
        importTaxPercent: initialGroup?.importTaxPercent ?? null,
        transferFee: initialGroup?.transferFee ?? null,
      }),
    [
      sourceType,
      sourceName,
      brand,
      country,
      parts,
      shippingCost,
      calculatedImportTax,
      warranty,
      installationIncluded,
      containsStockItems,
      currency,
      exchangeRate,
      actualExchangeRate,
      initialGroup,
      shippingCostFc,
    ]
  )
  const errorsByPart = useMemo(() => {
    const map = new Map<string, ValidationError[]>()
    for (const err of validationErrors) {
      if (!err.partId) continue
      map.set(err.partId, [...(map.get(err.partId) ?? []), err])
    }
    return map
  }, [validationErrors])
  const addPart = useCallback(() => {
    const newPart: ExternalPart = {
      ...createEmptyPart(exchangeRate ?? 0, currency),
      unit: units.length > 0 ? units[0].abbreviation : '',
    }
    setParts((prev) => [...prev, newPart])
    setPendingFocusPartId(newPart.id)
  }, [units, exchangeRate, currency])
  const updatePart = useCallback(
    (id: string, patch: Partial<ExternalPart>) => {
      setParts((prev) =>
        prev.map((part) => {
          if (part.id !== id) return part
          const updated = { ...part, ...patch }
          const unitCostTHB = toTHB(updated.unitCost, exchangeRate ?? 0)
          return {
            ...updated,
            unitCostTHB,
            unitPrice: calculateSellingPrice(
              unitCostTHB,
              updated.markupPercent,
              currency
            ),
          }
        })
      )
    },
    [exchangeRate, currency]
  )
  const removePart = useCallback((id: string) => {
    setParts((prev) => prev.filter((part) => part.id !== id))
  }, [])
  const markTouched = useCallback((partId: string, field: string) => {
    const key = `${partId}:${field}`
    setTouchedFields((prev) =>
      prev.has(key) ? prev : new Set(prev).add(key)
    )
  }, [])
  const handleSourceTypeChange = useCallback((value: SourceType) => {
    setSourceType(value)
    setWarranty(DEFAULT_WARRANTY[value])
    if (value === 'local_purchase') setShippingCost(0)
  }, [])

  const handleBufferChange = useCallback((value: number) => {
    const nextBuffer = Number.isFinite(value)
      ? Math.min(100, Math.max(0, value))
      : DEFAULT_CURRENCY_BUFFER
    setBufferPercent(nextBuffer)
    if (currency === 'THB') return

    if (rateSource === 'manual' || actualExchangeRate == null) {
      if (exchangeRate != null && exchangeRate > 0) {
        setExchangeRate(applyBuffer(actualExchangeRate, nextBuffer))
      }
      return
    }

    if (actualExchangeRate > 0) {
      setExchangeRate(applyBuffer(actualExchangeRate, nextBuffer))
    }
  }, [currency, rateSource, exchangeRate, actualExchangeRate])
  const loadBankRate = useCallback(async (code: CurrencyCode, date: string) => {
    if (api.mode !== 'ems') return
    if (code === 'THB') return
    const ticket = ++rateRequestRef.current
    setRateLoading(true)
    setRateError('')
    try {
      const entries = await fetchExchangeRates(date)
      if (rateRequestRef.current !== ticket) return
      const resolved = resolveRate(entries, code, bufferPercent)
      if (resolved) {
        setExchangeRate(applyBuffer(Number(resolved.entry.rateToTHB), bufferPercent))
        setActualExchangeRate(Number(resolved.entry.rateToTHB))
        setRateEntry(resolved.entry)
        setRateNotFoundFor(null)
        setRateSource('bank')
      } else {
        setExchangeRate(null)
        setActualExchangeRate(null)
        setRateEntry(null)
        setRateNotFoundFor({ currency: normalizeCurrencyCode(code), date })
        setRateSource('unset')
      }
    } catch (error) {
      if (rateRequestRef.current !== ticket) return
      setRateError(error instanceof Error ? error.message : 'Failed to load exchange rates')
      setRateEntry(null)
      setRateNotFoundFor(null)
    } finally {
      if (rateRequestRef.current === ticket) setRateLoading(false)
    }
  }, [bufferPercent])
  const handleCurrencyChange = useCallback((code: CurrencyCode) => {
    setCurrency(code)
    if (code === 'THB') {
      setExchangeRate(1)
      setActualExchangeRate(1)
      setRateSource('unset')
      setRateError('')
      setRateEntry(null)
      setRateNotFoundFor(null)
      return
    }
    if (api.mode !== 'ems') return
    setRateSource('unset')
    setRateError('')
    setRateEntry(null)
    setRateNotFoundFor(null)
    setExchangeRate(null)
    setActualExchangeRate(null)
    void loadBankRate(code, rateDate)
  }, [loadBankRate, rateDate])
  const handleDateChange = useCallback((date: string) => {
    setRateDate(date)
    if (currency === 'THB') return
    if (rateSource === 'manual') return
    void loadBankRate(currency, date)
  }, [currency, rateSource, loadBankRate])
  const handleManualRateChange = useCallback((value: number | null) => {
    setExchangeRate(value)
    setActualExchangeRate(
      value != null && value > 0 ? actualFromApplied(value, bufferPercent) : null
    )
    setRateSource('manual')
    setRateError('')
    setRateNotFoundFor(null)
    rateRequestRef.current += 1
  }, [bufferPercent])
  const useBankRate = useCallback(() => {
    void loadBankRate(currency, rateDate)
  }, [currency, rateDate, loadBankRate])
  const resetForm = useCallback(() => {
    setSourceType('import')
    setSourceName('')
    setBrand('')
    setCountry('')
    setParts([])
    setShippingCost(0)
    setCurrency('THB')
    setExchangeRate(1)
    setActualExchangeRate(1)
    setRateSource('unset')
    setRateDate(bangkokToday())
    setRateError('')
    setRateEntry(null)
    setRateNotFoundFor(null)
    setEstimatedDeliveryValue(0)
    setEstimatedDeliveryUnit('weeks')
    setWarranty(DEFAULT_WARRANTY.import)
    setInstallationIncluded(false)
    setContainsStockItems(false)
    setTouchedFields(new Set())
    setSubmitAttempted(false)
    setBufferPercent(DEFAULT_CURRENCY_BUFFER)
  }, [])
  const sourceNameValid = sourceName.trim().length > 0
  const hasParts = parts.length > 0
  const rateValid = currency === 'THB' || (exchangeRate !== null && exchangeRate > 0)
  const partsValid = parts.every(
    (part) =>
      part.partName.trim().length > 0 &&
      part.qty > 0 &&
      part.unitCost >= 0 &&
      part.unit.trim().length > 0
  )
  const canSubmit =
    sourceNameValid &&
    hasParts &&
    partsValid &&
    rateValid &&
    validationErrors.length === 0
  const missingSummary = useMemo(() => {
    if (canSubmit) return null
    const issues: string[] = []
    if (!sourceNameValid) issues.push('Supplier / Source')
    if (!hasParts) {
      issues.push('at least one part')
    } else if (!partsValid) {
      issues.push('part name, qty, and unit on every part')
    }
    if (!rateValid) issues.push('exchange rate > 0')
    if (validationErrors.length > 0) {
      issues.push(
        `${validationErrors.length} stock allocation ${validationErrors.length === 1 ? 'issue' : 'issues'
        }`
      )
    }
    return issues.length > 0 ? `Missing: ${issues.join(', ')}` : null
  }, [
    canSubmit,
    sourceNameValid,
    hasParts,
    partsValid,
    rateValid,
    validationErrors,
  ])
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit) {
      setSubmitAttempted(true)
      return
    }
    const estimatedDelivery =
      estimatedDeliveryValue > 0
        ? `${estimatedDeliveryValue} ${estimatedDeliveryUnit}`
        : ''

    const normalizedParts = parts.map((part) => {
      const unitCostTHB = toTHB(part.unitCost, exchangeRate ?? 0)
      const unitPrice = calculateSellingPrice(unitCostTHB, part.markupPercent, currency)
      const quotationQty = part.hasStockPortion
        ? Math.max(0, part.qty - part.stockQty)
        : part.qty
      const lineTotal = centsToMoney(moneyToCents(unitPrice) * quotationQty)
      const importTaxPercent = sourceType === 'import' ? (part.importTaxPercent ?? 0) : 0
      const importTaxAmount = roundDecimal(lineTotal * importTaxPercent / 100, 3)

      return {
        ...part,
        unitCost: roundDecimal(part.unitCost, 6),
        unitCostTHB,
        markupPercent: roundDecimal(part.markupPercent, 6),
        unitPrice,
        importTaxPercent,
        importTaxAmount,
      }
    })

    const group: ExternalGroup = {
      id: initialGroup?.id ?? createId(),
      sourceType,
      sourceName: sourceName.trim(),
      brand: brand.trim(),
      country: country.trim(),
      parts: normalizedParts,
      shippingCost: roundDecimal(shippingCost, 6),
      importTax: roundDecimal(calculatedImportTax, 6),
      estimatedDelivery,
      warranty,
      installationIncluded,
      containsStockItems,
      currency,
      exchangeRate: roundDecimal(exchangeRate ?? 0, 6),
      actualExchangeRate: currency === 'THB' ? 1 : roundDecimal(actualExchangeRate ?? 0, 6),
      exchangeRateDate:
        currency === 'THB' ? null : rateSource === 'bank' && rateEntry ? rateEntry.effectiveDate : rateDate,
      shippingCostFc: roundDecimal(shippingCostFc, 6),
      importTaxPercent: initialGroup?.importTaxPercent ?? null,
      transferFee: shippingBreakdown.transferFeeApplied,
      bufferPercent: roundDecimal(bufferPercent, 3),
    }
    onSubmit(group)
    resetForm()
  }
  const handleContainsStockItemsChange = useCallback((checked: boolean) => {
    setContainsStockItems(checked)
    if (!checked) {
      setParts((prev) => clearStockAllocation(prev))
    }
  }, [])
  const toggleHasStockPortion = useCallback(
    (id: string, checked: boolean) => {
      setParts((prev) =>
        prev.map((part) =>
          part.id === id
            ? {
              ...part,
              hasStockPortion: checked,
              stockQty: checked ? part.stockQty : 0,
            }
            : part
        )
      )
    },
    []
  )
  if (!open) return null
  const inputStyle: React.CSSProperties = {
    width: '100%',
    height: '34px',
    minHeight: '34px',
    boxSizing: 'border-box',
    padding: '6px 10px',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    background: '#fff',
    fontSize: '13px',
    lineHeight: '20px',
    display: 'block',
    flexShrink: 0,
    color: '#111827',
  }
  const numberInputStyle: React.CSSProperties = {
    ...inputStyle,
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
  }
  const labelStyle: React.CSSProperties = {
    display: 'block',
    marginBottom: '5px',
    fontSize: '12px',
    fontWeight: 600,
    color: '#374151',
  }
  const fieldStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    minWidth: 0,
  }

  const baseColumnWidths = showForeignCost
    ? 'minmax(140px, 1fr) 80px 100px 100px 110px 80px 120px 120px 110px'
    : 'minmax(160px, 1fr) 56px 72px 110px 72px 130px 130px 110px'

  const stockColumnWidths = '88px 120px 72px'
  const taxColumnWidth = '100px'

  const partsGridColumns = containsStockItems
    ? `${baseColumnWidths} ${taxColumnWidth} ${stockColumnWidths} 36px`
    : `${baseColumnWidths} ${taxColumnWidth} 36px`

  const partsHeaders = showForeignCost
    ? containsStockItems
      ? ['Part Name *', 'Qty', 'Unit', `Cost (${currency})`, 'Cost (THB)', 'Markup %', 'Selling', 'Total', 'Weight (kg)', 'Import Tax % / Amount', 'Keep stock', 'Quote Qty', '']
      : ['Part Name *', 'Qty', 'Unit', `Cost (${currency})`, 'Cost (THB)', 'Markup %', 'Selling', 'Total', 'Weight (kg)', 'Import Tax % / Amount', '']
    : containsStockItems
      ? ['Part Name *', 'Qty', 'Unit', 'Unit Cost', 'Markup %', 'Selling', 'Total', 'Import Tax % / Amount', 'Weight (kg)', 'Keep stock', 'Quote Qty', '']
      : ['Part Name *', 'Qty', 'Unit', 'Unit Cost', 'Markup %', 'Selling', 'Total', 'Import Tax % / Amount', '']

  const overlayStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: 1000,
    background: 'rgba(15, 23, 42, 0.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '16px',
  }
  const modalStyle: React.CSSProperties = {
    width: 'min(1320px, 100%)',
    maxHeight: '94vh',
    background: '#fff',
    borderRadius: '12px',
    boxShadow: '0 16px 40px rgba(15,23,42,0.14)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  }
  const sectionHeadingStyle: React.CSSProperties = {
    fontSize: '13px',
    fontWeight: 650,
    color: '#111827',
    letterSpacing: '0.01em',
  }
  const sectionSubtextStyle: React.CSSProperties = {
    marginTop: '2px',
    fontSize: '12px',
    color: '#6b7280',
  }
  const readOnlyBoxStyle: React.CSSProperties = {
    height: '34px',
    minHeight: '34px',
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    padding: '0 8px',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    background: '#f8fafc',
    fontSize: '12px',
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    color: '#374151',
  }
  const headerCellStyle: React.CSSProperties = {
    padding: '8px 6px',
    display: 'flex',
    alignItems: 'center',
    boxSizing: 'border-box',
    fontSize: '11px',
    fontWeight: 650,
    color: '#6b7280',
    whiteSpace: 'normal',
    lineHeight: 1.25,
  }
  return (
    <div style={overlayStyle} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div style={modalStyle} role="dialog" aria-modal="true">
        <div
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid #e5e7eb',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '12px',
            flexShrink: 0,
            background: '#fff',
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 650, color: '#111827' }}>
              {initialGroup ? 'Edit External Source' : 'Add External Source'}
            </h2>
            <div style={{ marginTop: '2px', fontSize: '12px', color: '#6b7280' }}>
              {initialGroup ? 'Edit supplier, parts, and costs' : 'Supplier, parts, and costs'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              width: '32px',
              height: '32px',
              border: '1px solid #e5e7eb',
              borderRadius: '6px',
              background: '#fff',
              fontSize: '18px',
              lineHeight: 1,
              cursor: 'pointer',
              color: '#6b7280',
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>
        <form
          onSubmit={handleSubmit}
          style={{
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '14px 16px 18px', overflowY: 'auto', minHeight: 0, flex: 1 }}>
            <div
              style={{
                border: '1px solid #e5e7eb',
                borderRadius: '10px',
                background: '#fff',
                padding: '12px 14px',
                marginBottom: '10px',
              }}
            >
              <div style={sectionHeadingStyle}>Source</div>
              <div style={{ ...sectionSubtextStyle, marginBottom: '8px' }}>
                Where these parts come from
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                  gap: '10px',
                  marginBottom: '8px',
                }}
              >
                <div style={fieldStyle}>
                  <label style={labelStyle}>Source Type *</label>
                  <select
                    value={sourceType}
                    onChange={(e) =>
                      handleSourceTypeChange(e.target.value as SourceType)
                    }
                    style={inputStyle}
                  >
                    <option value="import">Import</option>
                    <option value="local_supplier">Local Supplier</option>
                    <option value="local_purchase">Local Purchase</option>
                  </select>
                </div>
                <div style={fieldStyle}>
                  <label style={labelStyle}>Supplier / Source *</label>
                  <input
                    type="text"
                    value={sourceName}
                    onChange={(e) => setSourceName(e.target.value)}
                    placeholder="Supplier or source name"
                    style={inputStyle}
                  />
                </div>
                <div style={fieldStyle}>
                  <label style={labelStyle}>Country</label>
                  <input
                    type="text"
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    placeholder="e.g. USA"
                    style={inputStyle}
                  />
                </div>
                <div style={fieldStyle}>
                  <label style={labelStyle}>Brand</label>
                  <input
                    type="text"
                    value={brand}
                    onChange={(e) => setBrand(e.target.value)}
                    placeholder="e.g. Webasto"
                    style={inputStyle}
                  />
                </div>
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                  gap: '10px',
                  marginBottom: '8px',
                }}
              >
                <div style={fieldStyle}>
                  <label style={labelStyle}>Currency</label>
                  <select
                    data-testid="external-currency-select"
                    value={currency}
                    onChange={(e) =>
                      handleCurrencyChange(e.target.value as CurrencyCode)
                    }
                    style={inputStyle}
                  >
                    {CURRENCY_OPTIONS.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={fieldStyle}>
                  <label style={labelStyle}>
                    Exchange Rate (1 {currency} → THB)
                    {rateSource === 'manual' && (
                      <span
                        data-testid="external-rate-edited-label"
                        style={{
                          marginLeft: '6px',
                          fontSize: '11px',
                          fontWeight: 400,
                          color: '#b6473f',
                        }}
                      >
                        edited
                      </span>
                    )}
                  </label>
                  <div style={{ marginBottom: '6px' }}>
                    <label htmlFor="currency-buffer" style={labelStyle}>
                      Buffer (%)
                    </label>
                    <input
                      id="currency-buffer"
                      data-testid="currency-buffer-input"
                      type="number"
                      min={0}
                      max={500}
                      step="any"
                      value={bufferPercent}
                      onChange={(e) => {
                        const value = e.target.value === '' ? 0 : Number(e.target.value)
                        handleBufferChange(value)
                      }}
                      style={numberInputStyle}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center', minWidth: 0 }}>
                    <input
                      data-testid="external-rate-input"
                      type="number"
                      min="0"
                      step="0.000001"
                      value={exchangeRate ?? ''}
                      disabled={currency === 'THB'}
                      placeholder={api.mode === 'ems' && currency !== 'THB' && exchangeRate === null ? '0.000000' : undefined}
                      onChange={(e) => {
                        const raw = e.target.value
                        if (api.mode !== 'ems') {
                          const next = raw === '' ? 0 : Number(raw) || 0
                          setExchangeRate(next)
                          setActualExchangeRate(next > 0 ? actualFromApplied(next, bufferPercent) : null)
                          return
                        }
                        handleManualRateChange(raw === '' ? null : Number(raw) || 0)
                      }}
                      style={{
                        ...numberInputStyle,
                        background: currency === 'THB' ? '#f1f1f1' : '#fff',
                        width: 'auto',
                        flex: '1 1 auto',
                        minWidth: 0,
                      }}
                    />
                    {api.mode === 'ems' && currency !== 'THB' && (
                      <button
                        data-testid="external-use-bank-rate"
                        type="button"
                        onClick={useBankRate}
                        disabled={rateLoading}
                        title="Refetch today's bank rate and drop any manual edit"
                        style={{
                          height: '32px',
                          padding: '0 10px',
                          fontSize: '11px',
                          whiteSpace: 'nowrap',
                          flexShrink: 0,
                          border: '1px solid #ccc',
                          borderRadius: '5px',
                          background: '#fff',
                          cursor: rateLoading ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {rateLoading ? 'Loading…' : 'Use bank rate'}
                      </button>
                    )}
                  </div>
                  {api.mode === 'ems' && currency !== 'THB' && (
                    <div style={{ marginTop: '5px' }}>
                      <input
                        data-testid="external-rate-date-input"
                        type="date"
                        value={rateDate}
                        onChange={(e) => handleDateChange(e.target.value)}
                        style={{ ...inputStyle, fontSize: '12px', padding: '4px 6px', height: '26px' }}
                      />
                    </div>
                  )}
                  {api.mode === 'ems' && currency !== 'THB' && rateSource === 'bank' && rateEntry && (
                    <div data-testid="external-rate-info" style={{ marginTop: '5px', fontSize: '12px', color: '#2563eb' }}>
                      Bank {Number(rateEntry.rateToTHB)} + {bufferPercent}% buffer = {exchangeRate ?? '—'} · rate of {rateEntry.effectiveDate}
                      {' · '}{RATE_TYPE_LABELS[rateEntry.rateType] ?? rateEntry.rateType} · {rateEntry.source}
                      {rateEntry.effectiveDate !== rateDate && (
                        <> — rate of {rateEntry.effectiveDate} used</>
                      )}
                    </div>
                  )}
                  {api.mode === 'ems' && currency !== 'THB' && rateSource === 'loaded' && initialGroup?.exchangeRateDate && (
                    <div data-testid="external-rate-loaded" style={{ marginTop: '5px', fontSize: '12px', color: '#777' }}>
                      Rate of {initialGroup.exchangeRateDate} · stored
                    </div>
                  )}
                  {api.mode === 'ems' && currency !== 'THB' && rateSource === 'loaded' && !initialGroup?.exchangeRateDate && (
                    <div data-testid="external-rate-loaded" style={{ marginTop: '5px', fontSize: '12px', color: '#777' }}>
                      Stored rate from when this was saved.
                    </div>
                  )}
                  {api.mode === 'ems' && currency !== 'THB' && rateNotFoundFor && (
                    <div data-testid="external-rate-not-found" style={{ marginTop: '5px', fontSize: '12px', color: '#b6473f' }}>
                      No rate for {rateNotFoundFor.currency} on {rateNotFoundFor.date}
                    </div>
                  )}
                  {api.mode === 'ems' && currency !== 'THB' && rateError && (
                    <div data-testid="external-rate-error" style={{ marginTop: '5px', fontSize: '12px', color: '#b6473f' }}>
                      Could not load exchange rates: {rateError}
                    </div>
                  )}
                  {currency !== 'THB' && rateSource !== 'bank' && !rateError && !rateNotFoundFor && (
                    <div
                      style={{
                        marginTop: '5px',
                        fontSize: '12px',
                        color: '#777',
                      }}
                    >
                      e.g. 1 {currency} = 35.5000 THB → enter 35.5000
                    </div>
                  )}
                </div>
                <div style={fieldStyle}>
                  <label style={labelStyle}>Estimated Delivery</label>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: '8px',
                    }}
                  >
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={
                        estimatedDeliveryValue === 0
                          ? ''
                          : estimatedDeliveryValue
                      }
                      onChange={(e) => {
                        const value = Number(e.target.value)
                        setEstimatedDeliveryValue(
                          Number.isInteger(value) && value > 0 ? value : 0
                        )
                      }}
                      placeholder="Number"
                      style={numberInputStyle}
                    />
                    <select
                      value={estimatedDeliveryUnit}
                      onChange={(e) =>
                        setEstimatedDeliveryUnit(e.target.value as DeliveryUnit)
                      }
                      style={inputStyle}
                    >
                      <option value="days">Days</option>
                      <option value="weeks">Weeks</option>
                      <option value="months">Months</option>
                      <option value="years">Years</option>
                    </select>
                  </div>
                </div>
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                  gap: '10px',
                  marginBottom: '8px',
                }}
              >
                <div style={fieldStyle}>
                  <label style={labelStyle}>Shipping Cost Before VAT ({currency})</label>
                  <input
                    type="number"
                    min="0"
                    step="0.0001"
                    value={shippingCostFc}
                    disabled={sourceType === 'local_purchase'}
                    onChange={(e) =>
                      setShippingCostFc(roundDecimal(Number(e.target.value) || 0, 6))
                    }
                    style={{
                      ...numberInputStyle,
                      background: sourceType === 'local_purchase' ? '#f1f1f1' : '#fff',
                    }}
                  />
                  <div style={{ marginTop: '5px', fontSize: '12px', color: '#777' }}>
                    Shipping Cost Before VAT (THB): ฿
                    {shippingCost.toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </div>
                  <div style={{ marginTop: '3px', fontSize: '12px', color: '#777' }}>
                    + VAT 7% = ฿
                    {shippingVat.toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </div>
                </div>
                <div style={fieldStyle}>
                  <label style={labelStyle}>Total Import Duty / Tax (THB)</label>
                  <div style={{ ...readOnlyBoxStyle, background: '#f1f1f1' }}>
                    ฿{calculatedImportTax.toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </div>
                  <div style={{ marginTop: '5px', fontSize: '12px', color: '#777' }}>
                    Calculated from each part's Import Tax rate.
                  </div>
                </div>
                <div style={fieldStyle}>
                  <label style={labelStyle}>Warranty</label>
                  <input
                    type="text"
                    value={warranty}
                    onChange={(e) => setWarranty(e.target.value)}
                    placeholder="Warranty terms"
                    style={inputStyle}
                  />
                </div>
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  paddingTop: '4px',
                }}
              >
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '14px',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={installationIncluded}
                    onChange={(e) =>
                      setInstallationIncluded(e.target.checked)
                    }
                    style={{
                      width: '18px',
                      height: '18px',
                      minWidth: '18px',
                      minHeight: '18px',
                      margin: 0,
                    }}
                  />
                  Installation Included
                </label>
              </div>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '8px',
              }}
            >
              <div>
                <div style={sectionHeadingStyle}>Parts</div>
                <div style={sectionSubtextStyle}>
                  Add one or more parts from this source.
                  {showForeignCost && (
                    <>
                      {' '}
                      Unit cost is in <strong>{currency}</strong>, converted at
                      rate <strong>{exchangeRate ?? '(not set)'}</strong>.
                    </>
                  )}
                </div>
              </div>
            </div>
            {/* <div
              style={{
                marginTop: 12,
                padding: '12px 14px',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                background: '#f9fafb',
              }}
            >
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                <input
                  type="checkbox"
                  checked={containsStockItems}
                  onChange={(e) =>
                    handleContainsStockItemsChange(e.target.checked)
                  }
                />
                Contains stock items
              </label>
            </div> */}
            {parts.length === 0 ? (
              <div
                style={{
                  width: '100%',
                  minHeight: '100px',
                  border: '1px dashed #d1d5db',
                  borderRadius: '10px',
                  background: '#f9fafb',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'column',
                  gap: '10px',
                  marginTop: '12px',
                  boxSizing: 'border-box',
                }}
              >
                <div style={{ fontSize: '14px', color: '#777' }}>
                  No parts added yet.
                </div>
                <button
                  type="button"
                  onClick={addPart}
                  style={{
                    height: '36px',
                    padding: '0 14px',
                    border: '1px solid #2563eb',
                    borderRadius: '5px',
                    background: '#fff',
                    color: '#2563eb',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  + Add First Part
                </button>
              </div>
            ) : (
              <div
                style={{
                  width: '100%',
                  overflowX: 'auto',
                  marginTop: '12px',
                }}
              >
                <div style={{ minWidth: showForeignCost ? 860 : 720 }}>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: partsGridColumns,
                      minHeight: '40px',
                      alignItems: 'center',
                      borderBottom: '1px solid #e5e7eb',
                      background: '#f9fafb',
                    }}
                  >
                    {partsHeaders.map((header, idx) => (
                      <div
                        key={`${header}-${idx}`}
                        style={headerCellStyle}
                      >
                        {header}
                      </div>
                    ))}
                  </div>
                  {parts.map((part) => {
                    const partErrors = errorsByPart.get(part.id) ?? []
                    const weightError = partErrors.find(
                      (e) => e.field === 'unitWeight'
                    )
                    const stockQtyError = partErrors.find(
                      (e) => e.field === 'stockQty'
                    )
                    const unitMissing = !part.unit
                    const excludedFromQuotation =
                      part.hasStockPortion &&
                      part.stockQty >= part.qty &&
                      part.qty > 0
                    const quotationQtyValue = part.hasStockPortion
                      ? part.qty - part.stockQty
                      : part.qty
                    const lineTotal = centsToMoney(
                      moneyToCents(part.unitPrice) * quotationQtyValue
                    )
                    const importTaxPercent = part.importTaxPercent ?? 0
                    const importTaxAmount = roundDecimal(lineTotal * importTaxPercent / 100, 3)
                    const costTHB =
                      part.unitCostTHB ??
                      toTHB(part.unitCost, exchangeRate ?? 0)
                    const showWeightError =
                      weightError &&
                      (submitAttempted ||
                        touchedFields.has(`${part.id}:unitWeight`))
                    const showStockQtyError =
                      stockQtyError &&
                      (submitAttempted ||
                        touchedFields.has(`${part.id}:stockQty`))
                    const showUnitError =
                      unitMissing &&
                      (submitAttempted ||
                        touchedFields.has(`${part.id}:unit`))
                    return (
                      <div
                        key={part.id}
                        id={`external-part-row-${part.id}`}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: partsGridColumns,
                          minHeight: '48px',
                          alignItems: 'center',
                          borderBottom: '1px solid #eee',
                          boxSizing: 'border-box',
                          background:
                            pendingFocusPartId === part.id
                              ? '#fff7e0'
                              : '#fff',
                        }}
                      >
                        <div
                          style={{
                            padding: '0 6px',
                            minWidth: 0,
                            boxSizing: 'border-box',
                          }}
                        >
                          <input
                            id={`external-part-name-${part.id}`}
                            type="text"
                            value={part.partName}
                            onChange={(e) =>
                              updatePart(part.id, {
                                partName: e.target.value,
                              })
                            }
                            placeholder="Part name"
                            style={inputStyle}
                          />
                        </div>
                        <div
                          style={{
                            padding: '0 6px',
                            boxSizing: 'border-box',
                          }}
                        >
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={part.qty}
                            onChange={(e) =>
                              updatePart(part.id, {
                                qty: Math.max(
                                  1,
                                  Number(e.target.value) || 1
                                ),
                              })
                            }
                            style={numberInputStyle}
                          />
                        </div>
                        <div
                          style={{
                            padding: '0 6px',
                            boxSizing: 'border-box',
                          }}
                        >
                          <select
                            value={part.unit}
                            onChange={(e) =>
                              updatePart(part.id, {
                                unit: e.target.value,
                              })
                            }
                            onBlur={() =>
                              markTouched(part.id, 'unit')
                            }
                            disabled={unitsLoading}
                            style={{
                              ...inputStyle,
                              borderColor: showUnitError
                                ? '#d32f2f'
                                : '#ccc',
                            }}
                          >
                            <option value="">
                              {unitsLoading
                                ? 'Loading...'
                                : units.length === 0
                                  ? 'No units'
                                  : 'Select unit'}
                            </option>
                            {units.map((unit) => (
                              <option
                                key={unit.id}
                                value={unit.abbreviation}
                              >
                                {unit.abbreviation}
                              </option>
                            ))}
                          </select>
                          {showUnitError && (
                            <div
                              style={{
                                marginTop: '3px',
                                fontSize: '10px',
                                color: '#d32f2f',
                              }}
                            >
                              Required
                            </div>
                          )}
                        </div>
                        <div
                          style={{
                            padding: '0 6px',
                            boxSizing: 'border-box',
                          }}
                        >
                          <input
                            type="number"
                            min="0"
                            step="0.0001"
                            value={part.unitCost}
                            onChange={(e) =>
                              updatePart(part.id, {
                                unitCost: roundDecimal(
                                  Number(e.target.value) || 0,
                                  6
                                ),
                              })
                            }
                            placeholder={
                              showForeignCost ? currency : '0.0000'
                            }
                            style={numberInputStyle}
                          />
                        </div>
                        {showForeignCost && (
                          <div
                            style={{
                              padding: '0 6px',
                              boxSizing: 'border-box',
                            }}
                          >
                            <div style={readOnlyBoxStyle}>
                              ฿
                              {costTHB.toLocaleString('en-US', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </div>
                          </div>
                        )}
                        <div
                          style={{
                            padding: '0 6px',
                            boxSizing: 'border-box',
                          }}
                        >
                          <input
                            type="number"
                            min="0"
                            step="0.0001"
                            value={part.markupPercent}
                            onChange={(e) =>
                              updatePart(part.id, {
                                markupPercent: roundDecimal(
                                  Number(e.target.value) || 0,
                                  6
                                ),
                              })
                            }
                            style={numberInputStyle}
                          />
                        </div>
                        <div
                          style={{
                            padding: '0 6px',
                            boxSizing: 'border-box',
                          }}
                        >
                          <div style={readOnlyBoxStyle}>
                            ฿
                            {part.unitPrice.toLocaleString('en-US', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </div>
                        </div>
                        <div
                          style={{
                            padding: '0 6px',
                            boxSizing: 'border-box',
                          }}
                        >
                          <div
                            style={{
                              ...readOnlyBoxStyle,
                              background: '#f0f4f8',
                              fontWeight: 600,
                            }}
                          >
                            ฿
                            {lineTotal.toLocaleString('en-US', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </div>
                        </div>


                        <div style={{ padding: '0 6px', boxSizing: 'border-box' }}>
                          <select
                            value={importTaxPercent}
                            disabled={sourceType !== 'import'}
                            onChange={(e) => updatePart(part.id, { importTaxPercent: Number(e.target.value) })}
                            style={{ ...inputStyle, padding: '7px 4px', fontSize: '12px' }}
                          >
                            {IMPORT_TAX_OPTIONS.map((rate) => (
                              <option key={rate} value={rate}>{rate}%</option>
                            ))}
                          </select>
                          <div style={{ marginTop: '4px', fontSize: '11px', color: '#6b7280', textAlign: 'right' }}>
                            ฿{importTaxAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </div>
                        </div>

                        {containsStockItems && (
                          <>
                            <div style={{ padding: '0 6px' }}>
                              <input
                                type="number"
                                min="0"
                                step="0.0001"
                                value={
                                  part.unitWeight === 0
                                    ? ''
                                    : part.unitWeight
                                }
                                placeholder="0.0000"
                                onBlur={() =>
                                  markTouched(
                                    part.id,
                                    'unitWeight'
                                  )
                                }
                                onChange={(e) =>
                                  updatePart(part.id, {
                                    unitWeight: roundDecimal(
                                      Number(e.target.value) || 0,
                                      6
                                    ),
                                  })
                                }
                                style={{
                                  ...numberInputStyle,
                                  borderColor: showWeightError
                                    ? '#d32f2f'
                                    : '#ccc',
                                }}
                              />
                              {showWeightError && (
                                <div
                                  style={{
                                    marginTop: '3px',
                                    fontSize: '10px',
                                    color: '#d32f2f',
                                  }}
                                >
                                  Required, &gt; 0
                                </div>
                              )}
                            </div>
                            <div
                              style={{
                                padding: '0 6px',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '4px',
                                minWidth: 0,
                              }}
                            >
                              <label
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '5px',
                                  fontSize: '11px',
                                  color: '#555',
                                  cursor: 'pointer',
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={part.hasStockPortion}
                                  onChange={(e) =>
                                    toggleHasStockPortion(
                                      part.id,
                                      e.target.checked
                                    )
                                  }
                                />
                                Keep for inventory
                              </label>
                              {part.hasStockPortion && (
                                <>
                                  <input
                                    type="number"
                                    min="1"
                                    step="1"
                                    max={part.qty}
                                    placeholder="Qty"
                                    value={
                                      part.stockQty === 0
                                        ? ''
                                        : part.stockQty
                                    }
                                    onBlur={() =>
                                      markTouched(
                                        part.id,
                                        'stockQty'
                                      )
                                    }
                                    onChange={(e) =>
                                      updatePart(part.id, {
                                        stockQty:
                                          Number(e.target.value) || 0,
                                      })
                                    }
                                    style={{
                                      ...numberInputStyle,
                                      height: '30px',
                                      minHeight: '30px',
                                      borderColor:
                                        showStockQtyError
                                          ? '#d32f2f'
                                          : '#ccc',
                                    }}
                                  />
                                  {showStockQtyError && (
                                    <div
                                      style={{
                                        fontSize: '10px',
                                        color: '#d32f2f',
                                      }}
                                    >
                                      0 &lt; Qty ≤ {part.qty}
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                            <div
                              style={{
                                padding: '0 6px',
                                fontSize: '12px',
                              }}
                            >
                              {excludedFromQuotation ? (
                                <span style={{ color: '#d32f2f' }}>
                                  0 (to stock)
                                </span>
                              ) : (
                                <span>{quotationQtyValue}</span>
                              )}
                            </div>
                          </>
                        )}
                        <div
                          style={{
                            padding: '0 4px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxSizing: 'border-box',
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => removePart(part.id)}
                            title="Remove part"
                            style={{
                              width: '28px',
                              height: '28px',
                              minWidth: '28px',
                              minHeight: '28px',
                              padding: 0,
                              border: '1px solid #ddd',
                              borderRadius: '5px',
                              background: '#fff',
                              color: '#d32f2f',
                              cursor: 'pointer',
                              fontSize: '15px',
                              lineHeight: '26px',
                            }}
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    )
                  })}
                  <div
                    style={{
                      padding: '10px 8px',
                      display: 'flex',
                    }}
                  >
                    <button
                      type="button"
                      onClick={addPart}
                      style={{
                        height: '34px',
                        padding: '0 14px',
                        border: '1px solid #2563eb',
                        borderRadius: '5px',
                        background: '#fff',
                        color: '#2563eb',
                        fontWeight: 600,
                        fontSize: '13px',
                        cursor: 'pointer',
                      }}
                    >
                      + Add Part
                    </button>
                  </div>
                </div>
              </div>
            )}

            {parts.length > 0 && (
              <div
                style={{
                  marginTop: '12px',
                  border: '1px solid #e5e7eb',
                  borderRadius: '10px',
                  background: '#fff',
                  padding: '12px 14px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    gap: '12px',
                    marginBottom: '10px',
                  }}
                >
                  <div>
                    <div style={sectionHeadingStyle}>Summary</div>
                    <div style={sectionSubtextStyle}>Amounts that go on the quotation</div>
                  </div>
                  <div
                    style={{
                      fontSize: '18px',
                      fontWeight: 700,
                      color: '#1d4ed8',
                      fontVariantNumeric: 'tabular-nums',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    ฿ {groupTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                    gap: '8px',
                  }}
                >
                  {[
                    ['Parts', partsSubtotal],
                    ['Customer shipping', onQuotationShipping],
                    ['Import tax', calculatedImportTax],
                  ].map(([label, amount]) => (
                    <div
                      key={String(label)}
                      style={{
                        padding: '10px 12px',
                        borderRadius: '8px',
                        background: '#f8fafc',
                        border: '1px solid #f1f5f9',
                      }}
                    >
                      <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '4px' }}>
                        {label}
                      </div>
                      <div
                        style={{
                          fontSize: '14px',
                          fontWeight: 650,
                          color: '#111827',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        ฿ {Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Shipping calculation details */}
                <div
                  style={{
                    marginTop: '12px',
                    padding: '12px',
                    borderRadius: '8px',
                    border: '1px solid #dbeafe',
                    background: '#f8fbff',
                  }}
                >
                  <div style={{ fontSize: '13px', fontWeight: 700, color: '#1e40af', marginBottom: '10px' }}>
                    Shipping Breakdown
                  </div>

                  {[
                    [
                      `Shipping Cost (${currency})`,
                      `${currency} ${Number(shippingCostFc).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                    ],
                    [
                      'Shipping Cost (THB)',
                      `฿ ${Number(shippingBreakdown.shippingThb).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                    ],
                    [
                      `Exchange Rate`,
                      currency === 'THB' ? '1.0000' : Number(exchangeRate ?? 0).toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 }),
                    ],
                    [
                      `Shipping VAT (${(VAT_RATE * 100).toFixed(0)}%)`,
                      `฿ ${(shippingBreakdown.shippingThb * VAT_RATE).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                    ],
                    [
                      'Trans Fee',
                      `฿ ${Number(shippingBreakdown.transferFeeApplied ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                    ],
                    [
                      'Rounding Adjustment',
                      `฿ ${Number(shippingRoundingAdjustment).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                    ],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '5px 0',
                        fontSize: '12px',
                      }}
                    >
                      <span style={{ color: '#6b7280' }}>{label}</span>
                      <strong style={{ color: '#374151', fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>
                        {value}
                      </strong>
                    </div>
                  ))}

                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '12px',
                      marginTop: '6px',
                      paddingTop: '10px',
                      borderTop: '1px solid #dbeafe',
                      fontSize: '13px',
                    }}
                  >
                    <strong style={{ color: '#1e40af' }}>Customer Shipping Total</strong>
                    <strong style={{ color: '#1d4ed8', fontSize: '15px', fontVariantNumeric: 'tabular-nums' }}>
                      ฿ {Number(onQuotationShipping).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </strong>
                  </div>
                </div>

                {containsStockItems && (
                  <div
                    style={{
                      marginTop: '10px',
                      paddingTop: '10px',
                      borderTop: '1px solid #f1f5f9',
                      fontSize: '12px',
                      color: '#6b7280',
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '8px 16px',
                    }}
                  >
                    <span>
                      Box weight <strong style={{ color: '#374151' }}>{boxWeight.toFixed(2)} kg</strong>
                    </span>
                    <span>
                      Stock <strong style={{ color: '#374151' }}>{stockWeight.toFixed(2)} kg</strong>{' '}
                      ({(shippingAllocation.ratio * 100).toFixed(1)}%)
                    </span>
                    <span style={{ color: '#9ca3af' }}>
                      Internal split only — not shown to customer
                    </span>
                  </div>
                )}
              </div>
            )}

          </div>
          <div
            style={{
              padding: '10px 16px',
              borderTop: '1px solid #e5e7eb',
              display: 'flex',
              justifyContent: 'flex-end',
              alignItems: 'center',
              gap: '10px',
              background: '#fff',
              flexShrink: 0,
            }}
          >
            {missingSummary && (
              <div
                style={{
                  fontSize: '12px',
                  color: '#b91c1c',
                  marginRight: 'auto',
                }}
              >
                {missingSummary}
              </div>
            )}
            <button
              type="button"
              onClick={onClose}
              style={{
                height: '38px',
                padding: '0 16px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                background: '#fff',
                color: '#374151',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              style={{
                height: '38px',
                padding: '0 18px',
                border: 'none',
                borderRadius: '6px',
                background: canSubmit ? '#2563eb' : '#d1d5db',
                color: '#fff',
                fontWeight: 600,
                fontSize: '13px',
                cursor: canSubmit ? 'pointer' : 'not-allowed',
              }}
            >
              {initialGroup ? 'Save Changes' : 'Add External Source'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}