import jsPDF from 'jspdf'
// Resolved by the bundler (Vite/CRA) relative to this file — works in dev
// and in the built app, no machine-specific absolute path needed.
import cirrusLogoUrl from '../assets/CirrusLogo.png'

type QuoteItem = {
    source: 'stock' | 'external'
    brand: string
    partName: string
    qty: number
    unit: string
    unitPrice: number
    sourceType?: 'import' | 'local_supplier' | 'local_purchase'
    shippingIncluded?: boolean
    estimatedDelivery?: string
    importDutyIncluded?: boolean
    customsClearanceIncluded?: boolean
    additionalTransportIncluded?: boolean
    installationIncluded?: boolean
    warranty?: string
}

// ---- CTL (Consumables / Transportation / Labor) ----
// The wording of these four cost lines never changes quotation to quotation —
// only whether they're included, the price, and (for two of them) a one-line
// note. So the labels live here as a fixed config, shared with the form UI.
export const CTL_MARKUP = 0.07

export type CtlItemKey = 'consumable' | 'traveling' | 'gasoline' | 'labour'

export const CTL_ITEM_DEFS: {
    key: CtlItemKey
    label: string
    hasNote?: boolean
    notePlaceholder?: string
}[] = [
        { key: 'consumable', label: 'Consumable / Material / Protection' },
        {
            key: 'traveling',
            label: 'Traveling time / Depreciation',
            hasNote: true,
            notePlaceholder: 'e.g. Project location: Boat Lagoon',
        },
        { key: 'gasoline', label: 'Gasoline / Depreciation / Vehicles' },
        {
            key: 'labour',
            label: 'Labour Cost Estimation',
            hasNote: true,
            notePlaceholder: 'e.g. 1 Day / 1 Technicians: Delay Timer Repair, Replacement of Components & Reinstallation',
        },
    ]

export const computeCtlTotal = (price: number) =>
    Math.round(price * (1 + CTL_MARKUP) * 100) / 100

export type CtlItem = {
    label: string
    price: number
    total: number
    note?: string
}

type QuotationData = {
    quotationDate: string
    quotationNo: string
    customerName: string
    projectName: string
    workOrderNumber: string
    jobDescription: string
    validUntil: string
    items: QuoteItem[]
    ctlItems?: CtlItem[]
    discountPercent: number
    importTax: number
}

const COMPANY = {
    companies: [
        'AIR CONDITIONING & REFRIGERATION CO. LTD.',
        'CONSTRUCTION & COMMUNICATIONS CO. LTD.',
        'MARINE CO. LTD.',
        'MARINE SERVICES CO. LTD.',
    ],
    address: 'Phuket, Thailand',
    tel: '+66 (0)76 XXX XXX',
    email: 'info@cirrusmarine.com',
    website: 'www.cirrusmarine.com',
}

const BANK = {
    bankName: 'Bangkok Bank Public Company Limited',
    branch: 'Phuket Branch',
    accountName: 'Cirrus Marine Co., Ltd.',
    accountNo: 'XXXXXXXXXX',
    swift: 'XXXXXXXX',
    address: 'Phuket, Thailand',
    tel: '+66 (0)76 XXX XXX',
}

const formatMoney = (value: number) =>
    value.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })

const formatDate = (value: string) => {
    if (!value) return '-'
    const date = new Date(`${value}T00:00:00`)
    return date.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    })
}

// The bundler gives us a URL for the logo asset; jsPDF's addImage needs
// actual image data, so fetch it once and convert to a base64 data URL.
const loadImageAsDataUrl = (url: string): Promise<string> =>
    fetch(url)
        .then((response) => response.blob())
        .then(
            (blob) =>
                new Promise<string>((resolve, reject) => {
                    const reader = new FileReader()
                    reader.onloadend = () => resolve(reader.result as string)
                    reader.onerror = reject
                    reader.readAsDataURL(blob)
                })
        )

export const generateQuotationPDF = async (data: QuotationData) => {
    const pdf = new jsPDF('p', 'mm', 'a4')
    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    const margin = 10
    const contentWidth = pageWidth - margin * 2

    // Loaded once, reused on every page (drawPageHeader runs again on page breaks).
    const logoDataUrl = await loadImageAsDataUrl(cirrusLogoUrl)
    const LOGO_ASPECT = 824 / 226

    const OUTER_LINE = 0.30
    const INNER_LINE = 0.15

    // Job Description bar stays a distinct dark navy; the column-name
    // header row (Cost Items / Qty / Unit / Price / Total), the CTL bar,
    // and Total Due all use the brighter BLUE below.
    const NAVY = [27, 79, 120] as const
    const BLUE = [31, 124, 196] as const
    const LIGHT_BLUE_FILL = [191, 220, 242] as const
    const BORDER = [95, 95, 95] as const
    const TEXT = [65, 65, 65] as const
    const NOTE_RED = [190, 95, 95] as const

    let y = 12

    const ctlItems = data.ctlItems ?? []
    const subtotal = data.items.reduce((sum, item) => sum + item.qty * item.unitPrice, 0)
    const ctlTotal = ctlItems.reduce((sum, item) => sum + item.total, 0)
    // "Total" = items + import tax + CTL cost (all VAT-inclusive already).
    const totalWithTax = subtotal + data.importTax + ctlTotal
    // Discount only applies to the parts/items portion, not CTL or import tax.
    const discountAmount = subtotal * (data.discountPercent / 100)
    // Prices are entered VAT-inclusive, so Total Due = Total - Discount,
    // and Exc.VAT / VAT are just the backward-out breakdown of that figure.
    const totalDue = totalWithTax - discountAmount
    const totalExcVat = totalDue / 1.07
    const vat = totalDue - totalExcVat

    const setFont = (size: number, bold = false, italic = false) => {
        let style = 'normal'
        if (bold && italic) style = 'bolditalic'
        else if (bold) style = 'bold'
        else if (italic) style = 'italic'
        pdf.setFont('helvetica', style)
        pdf.setFontSize(size)
        pdf.setTextColor(...TEXT)
    }

    const drawPageHeader = () => {
        y = 14
        const logoX = margin
        const logoY = y
        const logoHeight = 15
        const logoWidth = logoHeight * LOGO_ASPECT
        pdf.addImage(logoDataUrl, 'PNG', logoX, logoY, logoWidth, logoHeight)

        pdf.setTextColor(...TEXT)
        pdf.setFont('helvetica', 'normal')
        pdf.setFontSize(4.5)
        COMPANY.companies.forEach((company, index) => {
            pdf.text(company, logoX + logoWidth + 3, y + 2 + index * 4)
        })

        setFont(7, false)
        pdf.text('Quotation #', pageWidth - 43, y + 19, { align: 'right' })
        setFont(7, true)
        pdf.text(data.quotationNo || 'DRAFT', pageWidth - margin, y + 19, { align: 'right' })
        setFont(7, false)
        pdf.text('Date:', pageWidth - 43, y + 23, { align: 'right' })
        pdf.text(formatDate(data.quotationDate), pageWidth - margin, y + 23, { align: 'right' })

        setFont(13, false)
        pdf.text(`${data.customerName || '-'} / Quotation`, margin + 1, y + 23)

        const barY = y + 25
        pdf.setFillColor(...NAVY)
        pdf.rect(margin, barY, contentWidth, 7, 'F')
        pdf.setTextColor(255, 255, 255)
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(7)
        pdf.text('Job Description', pageWidth / 2, barY + 4.8, { align: 'center' })

        const jobBoxY = barY + 7
        pdf.setDrawColor(...BORDER)
        pdf.setLineWidth(OUTER_LINE)
        pdf.rect(margin, jobBoxY, contentWidth, 10)
        setFont(8, true)
        pdf.text(data.jobDescription || data.projectName || '-', pageWidth / 2, jobBoxY + 6.5, { align: 'center' })

        y = jobBoxY + 10
    }

    // ---- Cost Items table geometry (5 columns) ----
    const qtyWidth = 13
    const unitWidth = 14
    const priceWidth = 31
    const totalWidth = 31
    const descriptionWidth = contentWidth - qtyWidth - unitWidth - priceWidth - totalWidth
    const xDescription = margin
    const xQty = xDescription + descriptionWidth
    const xUnit = xQty + qtyWidth
    const xPrice = xUnit + unitWidth
    const xTotal = xPrice + priceWidth

    const drawTableHeaderRow = () => {
        const headerHeight = 6.5
        pdf.setFillColor(...BLUE)
        pdf.setDrawColor(...BORDER)
        pdf.setLineWidth(OUTER_LINE)
        pdf.rect(margin, y, contentWidth, headerHeight, 'F')
        pdf.rect(margin, y, contentWidth, headerHeight)
        pdf.setLineWidth(INNER_LINE)
        pdf.line(xQty, y, xQty, y + headerHeight)
        pdf.line(xUnit, y, xUnit, y + headerHeight)
        pdf.line(xPrice, y, xPrice, y + headerHeight)
        pdf.line(xTotal, y, xTotal, y + headerHeight)

        pdf.setTextColor(255, 255, 255)
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(6.5)
        pdf.text('Cost Items', xDescription + 2, y + 4.3)
        pdf.text('Qty', xQty + qtyWidth / 2, y + 4.3, { align: 'center' })
        pdf.text('Unit', xUnit + unitWidth / 2, y + 4.3, { align: 'center' })
        pdf.text('Price THB / unit', xPrice + priceWidth / 2, y + 4.3, { align: 'center' })
        pdf.text('Total', xTotal + totalWidth / 2, y + 4.3, { align: 'center' })
        y += headerHeight
    }

    const drawSectionLabelRow = (label: string) => {
        const rowHeight = 5
        pdf.setDrawColor(...BORDER)
        pdf.setLineWidth(INNER_LINE)
        pdf.rect(margin, y, contentWidth, rowHeight)
        pdf.line(xQty, y, xQty, y + rowHeight)
        pdf.line(xUnit, y, xUnit, y + rowHeight)
        pdf.line(xPrice, y, xPrice, y + rowHeight)
        pdf.line(xTotal, y, xTotal, y + rowHeight)
        setFont(6.8, true)
        pdf.text(label, xDescription + 2, y + 3.6)
        y += rowHeight
    }

    // A full-width row inside the table border, no internal column dividers
    // (used for the blank spacer row and the shipping/delivery note line).
    const drawMergedRow = (rowHeight: number, draw?: () => void) => {
        pdf.setDrawColor(...BORDER)
        pdf.setLineWidth(INNER_LINE)
        pdf.rect(margin, y, contentWidth, rowHeight)
        draw?.()
        y += rowHeight
    }

    const drawCostTable = () => {
        drawTableHeaderRow()
        drawSectionLabelRow('Part needed')

        data.items.forEach((item) => {
            const productName = [item.brand, item.partName].filter(Boolean).join(' ')
            const lines = pdf.splitTextToSize(productName || '-', descriptionWidth - 4)
            const rowHeight = Math.max(6, lines.length * 3.2 + 2)

            if (y + rowHeight > pageHeight - 80) {
                pdf.addPage()
                drawPageHeader()
                drawTableHeaderRow()
            }

            pdf.setDrawColor(...BORDER)
            pdf.setLineWidth(INNER_LINE)
            pdf.rect(margin, y, contentWidth, rowHeight)
            pdf.line(xQty, y, xQty, y + rowHeight)
            pdf.line(xUnit, y, xUnit, y + rowHeight)
            pdf.line(xPrice, y, xPrice, y + rowHeight)
            pdf.line(xTotal, y, xTotal, y + rowHeight)

            setFont(6.5)
            pdf.text(lines, xDescription + 2, y + 3.8)
            pdf.text(String(item.qty), xQty + qtyWidth / 2, y + 3.8, { align: 'center' })
            pdf.text(item.unit?.toUpperCase() || 'EA', xUnit + unitWidth / 2, y + 3.8, { align: 'center' })
            pdf.text(formatMoney(item.unitPrice), xPrice + priceWidth - 2, y + 3.8, { align: 'right' })
            pdf.text(formatMoney(item.qty * item.unitPrice), xTotal + totalWidth - 2, y + 3.8, { align: 'right' })
            y += rowHeight
        })

        if (data.importTax > 0) {
            const rowHeight = 6
            pdf.setDrawColor(...BORDER)
            pdf.setLineWidth(INNER_LINE)
            pdf.rect(margin, y, contentWidth, rowHeight)
            pdf.line(xQty, y, xQty, y + rowHeight)
            pdf.line(xUnit, y, xUnit, y + rowHeight)
            pdf.line(xPrice, y, xPrice, y + rowHeight)
            pdf.line(xTotal, y, xTotal, y + rowHeight)
            setFont(6.5, false, true)
            pdf.text('Estimate Import Tax', xDescription + 2, y + 3.9)
            pdf.text('-', xQty + qtyWidth / 2, y + 3.9, { align: 'center' })
            pdf.text('-', xUnit + unitWidth / 2, y + 3.9, { align: 'center' })
            pdf.text('-', xPrice + priceWidth / 2, y + 3.9, { align: 'center' })
            pdf.text(formatMoney(data.importTax), xTotal + totalWidth - 2, y + 3.9, { align: 'right' })
            y += rowHeight
        }

        if (data.discountPercent > 0) {
            const rowHeight = 6
            pdf.setDrawColor(...BORDER)
            pdf.setLineWidth(INNER_LINE)
            pdf.rect(margin, y, contentWidth, rowHeight)
            pdf.line(xQty, y, xQty, y + rowHeight)
            pdf.line(xUnit, y, xUnit, y + rowHeight)
            pdf.line(xPrice, y, xPrice, y + rowHeight)
            pdf.line(xTotal, y, xTotal, y + rowHeight)
            setFont(6.5, false, true)
            pdf.text('Discount', xDescription + 2, y + 3.9)
            pdf.text('-', xQty + qtyWidth / 2, y + 3.9, { align: 'center' })
            pdf.text('-', xUnit + unitWidth / 2, y + 3.9, { align: 'center' })
            pdf.text(`${data.discountPercent}%`, xPrice + priceWidth / 2, y + 3.9, { align: 'center' })
            pdf.text(`-${formatMoney(discountAmount)}`, xTotal + totalWidth - 2, y + 3.9, { align: 'right' })
            y += rowHeight
        }

        // Blank spacer row, still inside the table border, then the
        // shipping/delivery note line — matching the real reference doc.
        const externalItems = data.items.filter((item) => item.source === 'external')
        const summaryBits: string[] = []
        externalItems.forEach((item) => {
            const bits: string[] = []
            if (item.shippingIncluded) bits.push('Shipping Cost is included')
            if (item.estimatedDelivery) bits.push(`Estimated delivery time is ${item.estimatedDelivery}`)
            if (bits.length) summaryBits.push(bits.join('. ') + '.')
        })

        if (summaryBits.length > 0) {
            drawMergedRow(4)
            drawMergedRow(5, () => {
                pdf.setTextColor(...NOTE_RED)
                pdf.setFont('helvetica', 'italic')
                pdf.setFontSize(6.3)
                pdf.text(summaryBits.join('  '), pageWidth / 2, y + 3.5, { align: 'center' })
            })
        }
    }

    const drawNotes = () => {
        const externalItems = data.items.filter((item) => item.source === 'external')
        if (externalItems.length === 0) return

        const noteTexts: string[] = []
        externalItems.forEach((item) => {
            const productName = [item.brand, item.partName].filter(Boolean).join(' ')
            const included: string[] = []
            const excluded: string[] = []

            if (item.shippingIncluded) included.push('shipping cost')
            else excluded.push('shipping cost')

            if (item.sourceType === 'import') {
                if (item.importDutyIncluded) included.push('import duty')
                else excluded.push('import duty')
                if (item.customsClearanceIncluded) included.push('customs clearance')
                else excluded.push('customs clearance')
            }

            if (item.additionalTransportIncluded) included.push('additional transport')
            else excluded.push('additional transport')

            if (item.installationIncluded) included.push('installation')
            else excluded.push('installation')

            let note = `Note: This quotation covers only the purchase of ${productName}.`
            if (included.length > 0) note += ` It includes ${included.join(', ')}.`
            if (excluded.length > 0) note += ` It excludes ${excluded.join(', ')}.`
            if (item.estimatedDelivery) note += ` Estimated delivery time is ${item.estimatedDelivery}.`
            if (item.warranty) note += ` Warranty is subject to ${item.warranty}.`
            note += ' Any extra costs, labor, or spare parts beyond this quotation will be charged separately.'

            noteTexts.push(note)
        })

        const maxWidth = contentWidth - 6
        const lines: string[] = []
        noteTexts.forEach((text) => {
            lines.push(...pdf.splitTextToSize(text, maxWidth))
        })

        const lineHeight = 3.5
        const boxHeight = lines.length * lineHeight + 6

        pdf.setFillColor(245, 245, 245)
        pdf.setDrawColor(...BORDER)
        pdf.setLineWidth(OUTER_LINE)
        pdf.rect(margin, y, contentWidth, boxHeight, 'FD')

        pdf.setTextColor(...NOTE_RED)
        pdf.setFont('helvetica', 'bolditalic')
        pdf.setFontSize(6.2)

        let noteY = y + 4.5
        lines.forEach((line) => {
            pdf.text(line, pageWidth / 2, noteY, { align: 'center' })
            noteY += lineHeight
        })

        y += boxHeight
    }

    // ---- CTL table geometry (3 columns: description, price, total) ----
    const ctlPriceWidth = 31
    const ctlTotalWidth = 31
    const ctlDescWidth = contentWidth - ctlPriceWidth - ctlTotalWidth
    const xCtlDesc = margin
    const xCtlPrice = xCtlDesc + ctlDescWidth
    const xCtlTotal = xCtlPrice + ctlPriceWidth

    const drawCtlTable = () => {
        if (ctlItems.length === 0) return

        // Header bar
        const barHeight = 6
        pdf.setFillColor(...BLUE)
        pdf.rect(margin, y, contentWidth, barHeight, 'F')
        pdf.setTextColor(255, 255, 255)
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(7)
        pdf.text('Consumables / Transportation / Labor Cost (CTL Cost)', xCtlDesc + 2, y + 4.0)
        pdf.text('Price THB/ unit', xCtlPrice + ctlPriceWidth / 2, y + 4.0, { align: 'center' })
        pdf.text('Total', xCtlTotal + ctlTotalWidth / 2, y + 4.0, { align: 'center' })
        y += barHeight

        const drawRow = (rowHeight: number, withDivider: boolean, draw: () => void) => {
            pdf.setDrawColor(...BORDER)
            pdf.setLineWidth(INNER_LINE)
            pdf.rect(margin, y, contentWidth, rowHeight)
            if (withDivider) {
                pdf.line(xCtlPrice, y, xCtlPrice, y + rowHeight)
                pdf.line(xCtlTotal, y, xCtlTotal, y + rowHeight)
            }
            draw()
            y += rowHeight
        }

        ctlItems.forEach((item) => {
            const rowHeight = 5.5
            drawRow(rowHeight, true, () => {
                setFont(6.8, true)
                pdf.text(item.label, xCtlDesc + 2, y + 3.7)
                pdf.text(formatMoney(item.price), xCtlPrice + ctlPriceWidth - 2, y + 3.7, { align: 'right' })
                pdf.text(formatMoney(item.total), xCtlTotal + ctlTotalWidth - 2, y + 3.7, { align: 'right' })
            })

            if (item.note) {
                const noteLines = pdf.splitTextToSize(item.note, ctlDescWidth - 4)
                const noteRowHeight = Math.max(4, noteLines.length * 3 + 1.5)
                drawRow(noteRowHeight, false, () => {
                    setFont(6.2, false, true)
                    pdf.text(noteLines, xCtlDesc + 2, y + 3.3)
                })
            }
        })

        drawRow(6, true, () => {
            setFont(6.8, false)
            pdf.text('CTL Total:', xCtlPrice - 2, y + 3.9, { align: 'right' })
            setFont(6.8, true)
            pdf.text(formatMoney(ctlTotal), xCtlTotal + ctlTotalWidth - 2, y + 3.9, { align: 'right' })
        })

        // Two blank filler rows directly above the summary, matching the
        // reference doc (one plain, one light-blue tinted).
        drawRow(4, true, () => { })
        pdf.setFillColor(...LIGHT_BLUE_FILL)
        pdf.rect(margin, y, contentWidth, 4, 'F')
        drawRow(4, true, () => { })
    }

    const drawSummary = () => {
        const summaryWidth = ctlPriceWidth + ctlTotalWidth
        const rowHeight = 6
        const totalHeight = 7
        const x = pageWidth - margin - summaryWidth
        const startY = y

        const rows: [string, number][] = [
            ['Total', totalWithTax],
            ['Total Discount', discountAmount],
            ['Total Exc. VAT', totalExcVat],
            ['VAT 7%', vat],
        ]

        pdf.setFillColor(238, 242, 246)
        pdf.setDrawColor(...BORDER)
        pdf.setLineWidth(OUTER_LINE)
        pdf.rect(x, startY, summaryWidth, rows.length * rowHeight + totalHeight)

        rows.forEach(([label, value], index) => {
            const rowY = startY + index * rowHeight
            if (index > 0) {
                pdf.setLineWidth(INNER_LINE)
                pdf.line(x, rowY, x + summaryWidth, rowY)
            }
            setFont(6.8, index >= 2)
            pdf.text(label, x + 3, rowY + 4.0)
            pdf.text(value === 0 ? '-' : formatMoney(value), x + summaryWidth - 3, rowY + 4.0, { align: 'right' })
        })

        const totalDueY = startY + rows.length * rowHeight
        pdf.setFillColor(...BLUE)
        pdf.setDrawColor(...BORDER)
        pdf.setLineWidth(OUTER_LINE)
        pdf.rect(x, totalDueY, summaryWidth, totalHeight, 'FD')
        pdf.setTextColor(255, 255, 255)
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(8)
        pdf.text('TOTAL DUE', x + 3, totalDueY + 5.0)
        pdf.text(formatMoney(totalDue), x + summaryWidth - 3, totalDueY + 5.0, { align: 'right' })

        y = totalDueY + totalHeight + 7
    }

    const drawPaymentAndRemarks = () => {
        if (y > pageHeight - 78) {
            pdf.addPage()
            drawPageHeader()
        }

        pdf.setTextColor(...NOTE_RED)
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(7)
        pdf.text('Payment Terms:', margin, y)
        y += 5

        setFont(6.5)
        pdf.text(`- Full payment is needed to confirm the order. (${formatMoney(totalDue)} THB)`, margin + 2, y)
        y += 9

        pdf.setTextColor(...NOTE_RED)
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(7)
        pdf.text('Remarks:', margin, y)
        y += 5

        setFont(6.2)
        const remarks = [
            'This quotation is only the estimate price and valid for 30 days. VAT is included.',
            'Please be reminded that additional charges might occur if:',
            '  (a) unforeseeable problems are found during the work progress',
            '  (b) there is work beyond the scope as mentioned in this quotation',
            '  (c) there are conditions at the job site which slow down or stop the work progress',
            'Labor cost is not included. Shipping cost is not all included. Please refer to each item.',
            'Delivery time is to be confirmed at the time of order, depending on product availability.',
            'Project start date can be confirmed after deposit or full payment is made.',
        ]

        remarks.forEach((remark) => {
            const lines = pdf.splitTextToSize(`- ${remark}`, contentWidth)
            pdf.text(lines, margin + 2, y)
            y += lines.length * 3.5 + 1
        })

        y += 3
    }

    const drawBankInformation = () => {
        if (y > pageHeight - 55) {
            pdf.addPage()
            drawPageHeader()
        }

        const boxHeight = 39
        pdf.setDrawColor(...BORDER)
        pdf.setLineWidth(OUTER_LINE)
        pdf.rect(margin, y, contentWidth, boxHeight)

        setFont(7, true)
        pdf.text('Bank Information:', margin + 3, y + 6)

        setFont(6.2)
        const bankLines = [
            `Bank Name : ${BANK.bankName} (${BANK.branch})`,
            `Bank Address : ${BANK.address}`,
            `A/C Name : ${BANK.accountName}`,
            `A/C No : ${BANK.accountNo} (Savings Account)   ;   Swift code : ${BANK.swift}`,
            `Address : ${BANK.address}`,
            `Tel : ${BANK.tel}`,
        ]

        bankLines.forEach((line, index) => {
            pdf.text(line, margin + 3, y + 11 + index * 4.5)
        })

        y += boxHeight
    }

    const drawFooter = () => {
        const pageCount = pdf.getNumberOfPages()
        for (let page = 1; page <= pageCount; page++) {
            pdf.setPage(page)
            pdf.setTextColor(130, 130, 130)
            pdf.setFont('helvetica', 'normal')
            pdf.setFontSize(5)
            pdf.text(`Page ${page} of ${pageCount}`, pageWidth - margin, pageHeight - 5, { align: 'right' })
        }
    }

    drawPageHeader()
    drawCostTable()
    drawNotes()
    drawCtlTable()
    drawSummary()
    drawPaymentAndRemarks()
    drawBankInformation()
    drawFooter()

    pdf.save(`Quotation-${data.quotationDate || 'draft'}.pdf`)
}