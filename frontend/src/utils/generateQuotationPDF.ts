import jsPDF from 'jspdf'
import cirrusLogoUrl from '../assets/CirrusLogo.png'
import {
	type ExternalGroup,
	type ExternalPart,
	type ShippingRule,
} from './externalPartsAllocation'
import {
	buildQuotationRows,
	computeQuotationTotals,
	type PdfRow,
} from './quotationRows'
import { calculateEstimatedDelivery } from '../utils/estimatedDelivery'

import {
	COMPANY,
	BANKS,
	PDF_LAYOUT,
	CTL_MARKUP,
	CTL_ITEM_DEFS,
	computeCtlTotal,
	type CtlItemKey,
} from './quotationPdfConfig'

// Stock items may still carry a brand from the database (see App.tsx's
// StockQuoteItem) -- this PDF never renders it, so it's not part of the
// shape this module needs to read. `id` is required only to satisfy
// buildQuotationRows's QuotationStockItem shape (quotationRows.ts) -- the
// real objects passed in (App.tsx's StockQuoteItem) always have one.
type QuoteItem = {
	id: string
	source: 'stock' | 'external'
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

// Re-export CTL stuff so existing imports still work
export { CTL_MARKUP, CTL_ITEM_DEFS, computeCtlTotal }
export type { CtlItemKey }

export type { ExternalGroup, ExternalPart }

export type CtlItem = {
	label: string
	price: number
	total: number
	note?: string
}

export type QuotationData = {
	companyCode: 'CA' | 'CM' | 'CS'
	quotationNo: string
	quotationDate: string
	clientId?: string
	customerName: string
	projectName: string
	projectId?: string
	jobDescription: string
	validUntil: string
	status: string
	items: any[]
	externalGroups: any[]
	ctlItems: any[]
	ctlState: any
	discountPercent: number
	note: string
	// claude_prompt.txt ("shipping price rule B"): this generator recomputes
	// its own rows/totals internally (below) rather than trusting
	// `totals.shippingTotal` -- it needs the rule for that recompute. Not
	// part of the save payload (see App.tsx's exportPDF).
	shippingRule: ShippingRule
	totals: {
		subtotal: number
		discountAmount: number
		shippingTotal: number
		importTaxTotal: number
		ctlTotal: number
		totalExcVat: number
		vat: number
		totalDue: number
	}
}

// ============================================================
// HELPERS
// ============================================================

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

const todayTH = () => {
	const d = new Date()
	const dd = String(d.getDate()).padStart(2, '0')
	const mm = String(d.getMonth() + 1).padStart(2, '0')
	const yyyy = d.getFullYear()

	return `${dd}/${mm}/${yyyy}`
}

// ============================================================
// PDF GENERATOR
// ============================================================

export const generateQuotationPDF = async (data: QuotationData) => {
	const pdf = new jsPDF('p', 'mm', 'a4')

	const pageWidth = pdf.internal.pageSize.getWidth()
	const pageHeight = pdf.internal.pageSize.getHeight()
	const margin = PDF_LAYOUT.page.margin
	const contentWidth = pageWidth - margin * 2

	const logoDataUrl = await loadImageAsDataUrl(cirrusLogoUrl)
	const LOGO_ASPECT = 824 / 226

	const FOOTER_HEIGHT = PDF_LAYOUT.footer.height
	const FOOTER_BOTTOM = PDF_LAYOUT.footer.bottomMargin

	const contentLimit = () =>
		pageHeight - FOOTER_BOTTOM - FOOTER_HEIGHT - 4

	const OUTER_LINE = 0.1
	const INNER_LINE = 0.1

	const NAVY = [27, 79, 120] as const
	const BLUE = [31, 124, 196] as const
	const LIGHT_BLUE_FILL = [191, 220, 242] as const
	const BORDER = [0, 0, 0] as const
	const TEXT = [65, 65, 65] as const
	const NOTE_RED = [255, 0, 0] as const

	let y = 12

	const externalGroups = data.externalGroups ?? []
	const ctlItems = data.ctlItems ?? []

	const rows = buildQuotationRows(data.items, externalGroups, data.shippingRule)

	const ctlTotal = ctlItems.reduce((sum, item) => sum + item.total, 0)

	const {
		partsSubtotal: subtotal,
		shippingTotal,
		importTaxTotal,
		discountAmount,
		totalDue,
	} = computeQuotationTotals(
		data.items,
		externalGroups,
		ctlTotal,
		data.discountPercent || 0,
		data.shippingRule
	)

	// Same rounding as App.tsx's own totalExcVat/vat (and QuotationView's
	// mirror of it) -- round the exc-VAT figure first, then derive VAT as
	// the remainder, so all three places can never disagree by a cent at
	// a rounding-boundary total.
	const totalExcVat = Math.round((totalDue / 1.07) * 100) / 100
	const vat = Math.round((totalDue - totalExcVat) * 100) / 100

	const setFont = (size: number, bold = false, italic = false) => {
		let style = 'normal'

		if (bold && italic) {
			style = 'bolditalic'
		} else if (bold) {
			style = 'bold'
		} else if (italic) {
			style = 'italic'
		}

		pdf.setFont('helvetica', style)
		pdf.setFontSize(size)
		pdf.setTextColor(...TEXT)
	}

	const getCenterY = (rowY: number, rowHeight: number) =>
		rowY + rowHeight / 2

	const drawCenteredText = (
		text: string,
		x: number,
		rowY: number,
		rowHeight: number,
		options: any = {}
	) => {
		pdf.text(text, x, getCenterY(rowY, rowHeight), {
			...options,
			baseline: 'middle',
		})
	}

	const drawCenteredTextBlock = (
		lines: string[],
		x: number,
		rowY: number,
		rowHeight: number,
		lineHeight: number,
		options: any = {}
	) => {
		const blockHeight = lines.length * lineHeight
		const startY = rowY + (rowHeight - blockHeight) / 2 + lineHeight / 2

		pdf.text(lines, x, startY, {
			...options,
			baseline: 'middle',
		})
	}

	const drawPageHeader = () => {
		y = PDF_LAYOUT.header.top

		const logoX = margin
		const logoY = y
		const logoHeight = PDF_LAYOUT.header.logoHeight
		const logoWidth = logoHeight * LOGO_ASPECT

		pdf.addImage(logoDataUrl, 'PNG', logoX, logoY, logoWidth, logoHeight)

		pdf.setTextColor(...TEXT)
		pdf.setFont('helvetica', 'normal')
		pdf.setFontSize(7)

		COMPANY.companies.forEach((company, index) => {
			pdf.text(company, logoX + logoWidth + 3, y + 2 + index * 4)
		})

		setFont(9)

		pdf.text('Quotation #', pageWidth - 43, y + 19, {
			align: 'right',
		})

		setFont(9, true)

		pdf.text(data.quotationNo || 'DRAFT', pageWidth - margin, y + 19, {
			align: 'right',
		})

		setFont(9)

		pdf.text('Date:', pageWidth - 43, y + 23, {
			align: 'right',
		})

		pdf.text(formatDate(data.quotationDate), pageWidth - margin, y + 23, {
			align: 'right',
		})

		setFont(20)

		pdf.text(`${data.projectName || '-'} / Quotation`, margin + 1, y + 23)

		const barY = y + 25
		const barHeight = PDF_LAYOUT.header.jobBarHeight

		pdf.setFillColor(...NAVY)
		pdf.rect(margin, barY, contentWidth, barHeight, 'F')

		pdf.setTextColor(255, 255, 255)
		pdf.setFont('helvetica', 'bold')
		pdf.setFontSize(11)

		drawCenteredText('Job Description', pageWidth / 2, barY, barHeight, {
			align: 'center',
		})

		const jobBoxY = barY + PDF_LAYOUT.header.jobBarHeight
		const jobBoxHeight = PDF_LAYOUT.header.jobBoxHeight

		pdf.setDrawColor(...BORDER)
		pdf.setLineWidth(OUTER_LINE)

		pdf.rect(margin, jobBoxY, contentWidth, jobBoxHeight)

		setFont(11, true)

		const jobText = data.jobDescription || data.projectName || '-'

		drawCenteredText(
			jobText,
			pageWidth / 2,
			jobBoxY,
			jobBoxHeight,
			{ align: 'center' }
		)

		y = jobBoxY + jobBoxHeight
	}

	// ========================================================
	// COST ITEM TABLE
	// ========================================================

	const qtyWidth = PDF_LAYOUT.columns.qty
	const unitWidth = PDF_LAYOUT.columns.unit
	const priceWidth = PDF_LAYOUT.columns.price
	const totalWidth = PDF_LAYOUT.columns.total

	const descriptionWidth =
		contentWidth - qtyWidth - unitWidth - priceWidth - totalWidth

	const xDescription = margin
	const xQty = xDescription + descriptionWidth
	const xUnit = xQty + qtyWidth
	const xPrice = xUnit + unitWidth
	const xTotal = xPrice + priceWidth

	const drawTableHeaderRow = () => {
		const headerHeight = PDF_LAYOUT.table.headerHeight
		const rowY = y

		pdf.setFillColor(...BLUE)
		pdf.setDrawColor(...BORDER)
		pdf.setLineWidth(OUTER_LINE)

		pdf.rect(margin, rowY, contentWidth, headerHeight, 'F')
		pdf.rect(margin, rowY, contentWidth, headerHeight)

		pdf.setLineWidth(INNER_LINE)

		pdf.line(xQty, rowY, xQty, rowY + headerHeight)
		pdf.line(xUnit, rowY, xUnit, rowY + headerHeight)
		pdf.line(xPrice, rowY, xPrice, rowY + headerHeight)
		pdf.line(xTotal, rowY, xTotal, rowY + headerHeight)

		pdf.setTextColor(255, 255, 255)
		pdf.setFont('helvetica', 'bold')
		pdf.setFontSize(PDF_LAYOUT.typography.tableHeader)

		drawCenteredText('Cost Items', xDescription + 2, rowY, headerHeight)

		drawCenteredText('Qty', xQty + qtyWidth / 2, rowY, headerHeight, {
			align: 'center',
		})

		drawCenteredText('Unit', xUnit + unitWidth / 2, rowY, headerHeight, {
			align: 'center',
		})

		drawCenteredText(
			'Price THB / unit',
			xPrice + priceWidth / 2,
			rowY,
			headerHeight,
			{ align: 'center' }
		)

		drawCenteredText('Total', xTotal + totalWidth / 2, rowY, headerHeight, {
			align: 'center',
		})

		y += headerHeight
	}

	const drawSectionLabelRow = (label: string) => {
		const rowHeight = PDF_LAYOUT.table.sectionHeight
		const rowY = y

		pdf.setDrawColor(...BORDER)
		pdf.setLineWidth(INNER_LINE)

		pdf.rect(margin, rowY, contentWidth, rowHeight)

		setFont(PDF_LAYOUT.typography.section, true)

		drawCenteredText(label, margin + contentWidth / 2, rowY, rowHeight, {
			align: 'center',
		})

		y += rowHeight
	}

	const ensureSpace = (needed: number) => {
		if (y + needed > contentLimit()) {
			pdf.addPage()
			drawPageHeader()
			drawTableHeaderRow()
		}
	}

	const ensureBlockSpace = (needed: number) => {
		if (y + needed > contentLimit()) {
			pdf.addPage()
			drawPageHeader()
		}
	}

	type PartPdfRow = Extract<PdfRow, { kind: 'stock' | 'external-part' }>

	const drawCostTable = () => {
		drawTableHeaderRow()

		const stockRows = rows.pdfRows.filter((row) => row.kind === 'stock')

		const externalPartRows = rows.pdfRows.filter(
			(row) => row.kind === 'external-part'
		)

		const shippingRows = rows.pdfRows.filter(
			(row) => row.kind === 'external-shipping'
		)

		const importTaxRows = rows.pdfRows.filter(
			(row) => row.kind === 'import-tax'
		)

		const noBrandRows: PartPdfRow[] = [
			...stockRows,
			...externalPartRows.filter((row) => !row.brand.trim()),
		]

		const brandedRows = new Map<string, typeof externalPartRows>()

		externalPartRows.forEach((row) => {
			const brand = row.brand.trim()

			if (!brand) return

			const brandKey = brand.toLowerCase()

			if (!brandedRows.has(brandKey)) {
				brandedRows.set(brandKey, [])
			}

			brandedRows.get(brandKey)!.push(row)
		})

		const drawPartRows = (partRows: PartPdfRow[]) => {
			partRows.forEach((row) => {
				const name = row.kind === 'stock' ? row.item.partName : row.part.partName
				const qty = row.kind === 'stock' ? row.item.qty : row.part.quotationQty
				const unit = row.kind === 'stock' ? row.item.unit : row.part.unit
				const unitPrice = row.kind === 'stock' ? row.item.unitPrice : row.part.unitPrice

				const fontSize = PDF_LAYOUT.typography.tableText
				setFont(fontSize)

				const lines = pdf.splitTextToSize(
					name || '-',
					descriptionWidth - 4
				)

				// line height จากขนาดฟอนต์ (ไม่ hardcode)
				const lineHeight = fontSize * 0.4
				const rowHeight = Math.max(
					PDF_LAYOUT.table.itemMinHeight,
					lines.length * lineHeight + PDF_LAYOUT.table.itemPadding
				)

				ensureSpace(rowHeight)

				const rowY = y

				pdf.setDrawColor(...BORDER)
				pdf.setLineWidth(INNER_LINE)

				pdf.rect(margin, rowY, contentWidth, rowHeight)

				pdf.line(xQty, rowY, xQty, rowY + rowHeight)
				pdf.line(xUnit, rowY, xUnit, rowY + rowHeight)
				pdf.line(xPrice, rowY, xPrice, rowY + rowHeight)
				pdf.line(xTotal, rowY, xTotal, rowY + rowHeight)

				setFont(fontSize)

				drawCenteredTextBlock(
					lines,
					xDescription + 2,
					rowY,
					rowHeight,
					lineHeight
				)

				drawCenteredText(
					String(qty),
					xQty + qtyWidth / 2,
					rowY,
					rowHeight,
					{ align: 'center' }
				)

				drawCenteredText(
					unit?.toUpperCase() || 'EA',
					xUnit + unitWidth / 2,
					rowY,
					rowHeight,
					{ align: 'center' }
				)

				drawCenteredText(
					unitPrice === 0 ? '' : formatMoney(unitPrice),
					xPrice + priceWidth - 2,
					rowY,
					rowHeight,
					{ align: 'right' }
				)

				drawCenteredText(
					qty * unitPrice === 0 ? '' : formatMoney(qty * unitPrice),
					xTotal + totalWidth - 2,
					rowY,
					rowHeight,
					{ align: 'right' }
				)

				y += rowHeight
			})
		}

		const drawShippingRow = (label: string, amount: number) => {
			const rowHeight = PDF_LAYOUT.table.shippingHeight

			ensureSpace(rowHeight)

			const rowY = y

			pdf.setDrawColor(...BORDER)
			pdf.setLineWidth(INNER_LINE)

			pdf.rect(margin, rowY, contentWidth, rowHeight)

			pdf.line(xQty, rowY, xQty, rowY + rowHeight)
			pdf.line(xUnit, rowY, xUnit, rowY + rowHeight)
			pdf.line(xPrice, rowY, xPrice, rowY + rowHeight)
			pdf.line(xTotal, rowY, xTotal, rowY + rowHeight)

			setFont(PDF_LAYOUT.typography.small, false, true) // italic

			// label ชิดขวาของคอลัมน์ description
			drawCenteredText(label, xQty - 2, rowY, rowHeight, {
				align: 'right',
			})

			// Qty = 1
			drawCenteredText('1', xQty + qtyWidth / 2, rowY, rowHeight, {
				align: 'center',
			})

			// Unit = LOT
			drawCenteredText('LOT', xUnit + unitWidth / 2, rowY, rowHeight, {
				align: 'center',
			})

			// Price
			drawCenteredText(
				formatMoney(amount),
				xPrice + priceWidth - 2,
				rowY,
				rowHeight,
				{ align: 'right' }
			)

			// Total
			drawCenteredText(
				formatMoney(amount),
				xTotal + totalWidth - 2,
				rowY,
				rowHeight,
				{ align: 'right' }
			)

			y += rowHeight
		}

		const drawImportTaxRow = (amount: number) => {
			const rowHeight = PDF_LAYOUT.table.importTaxHeight

			ensureSpace(rowHeight)

			const rowY = y

			pdf.setDrawColor(...BORDER)
			pdf.setLineWidth(INNER_LINE)

			pdf.rect(margin, rowY, contentWidth, rowHeight)

			pdf.line(xQty, rowY, xQty, rowY + rowHeight)
			pdf.line(xUnit, rowY, xUnit, rowY + rowHeight)
			pdf.line(xPrice, rowY, xPrice, rowY + rowHeight)
			pdf.line(xTotal, rowY, xTotal, rowY + rowHeight)

			setFont(PDF_LAYOUT.typography.small, false, true) // italic

			// label ชิดขวาของคอลัมน์ description
			drawCenteredText(
				'Estimated Import Tax',
				xQty - 2,
				rowY,
				rowHeight,
				{ align: 'right' }
			)

			// Qty / Unit / Price = "-"
			drawCenteredText('-', xQty + qtyWidth / 2, rowY, rowHeight, {
				align: 'center',
			})
			drawCenteredText('-', xUnit + unitWidth / 2, rowY, rowHeight, {
				align: 'center',
			})
			drawCenteredText('-', xPrice + priceWidth / 2, rowY, rowHeight, {
				align: 'center',
			})

			// Total
			drawCenteredText(
				amount === 0 ? '-' : formatMoney(amount),
				xTotal + totalWidth - 2,
				rowY,
				rowHeight,
				{ align: 'right' }
			)

			y += rowHeight
		}

		if (noBrandRows.length > 0) {
			drawSectionLabelRow('Part needed')
			drawPartRows(noBrandRows)
		}

		brandedRows.forEach((partRows, brandKey) => {
			const brand = partRows[0]?.brand.trim() || brandKey

			drawSectionLabelRow(`Part needed - ${brand}`)
			drawPartRows(partRows)

			const brandShippingRows = shippingRows.filter(
				(row) => row.brand.trim().toLowerCase() === brandKey
			)

			brandShippingRows.forEach((row) => {
				drawShippingRow(row.label, row.amount)
			})

			const brandImportTaxRows = importTaxRows.filter(
				(row) => row.brand.trim().toLowerCase() === brandKey
			)

			brandImportTaxRows.forEach((row) => {
				drawImportTaxRow(row.amount)
			})
		})

		const noBrandShippingRows = shippingRows.filter(
			(row) => !row.brand.trim()
		)

		noBrandShippingRows.forEach((row) => {
			drawShippingRow(row.label, row.amount)
		})

		const noBrandImportTaxRows = importTaxRows.filter(
			(row) => !row.brand.trim()
		)

		noBrandImportTaxRows.forEach((row) => {
			drawImportTaxRow(row.amount)
		})

		if ((data.discountPercent || 0) > 0) {
			const rowHeight = PDF_LAYOUT.table.discountHeight

			ensureSpace(rowHeight)

			const rowY = y

			pdf.setDrawColor(...BORDER)
			pdf.setLineWidth(INNER_LINE)

			// กรอบนอก
			pdf.rect(margin, rowY, contentWidth, rowHeight)

			// เส้นแบ่งแค่ 2 เส้น → 3 คอลัมน์: Discount | % | total
			pdf.line(xPrice, rowY, xPrice, rowY + rowHeight)
			pdf.line(xTotal, rowY, xTotal, rowY + rowHeight)

			setFont(PDF_LAYOUT.typography.tableText, true) // bold

			// คอลัมน์ 1: "Discount" ชิดขวา
			drawCenteredText(
				'Discount',
				xPrice - 2,
				rowY,
				rowHeight,
				{ align: 'right' }
			)

			// คอลัมน์ 2: "%" ชิดขวา
			drawCenteredText(
				`${data.discountPercent}%`,
				xPrice + priceWidth - 2,
				rowY,
				rowHeight,
				{ align: 'right' }
			)

			// คอลัมน์ 3: ยอดเงิน ชิดขวา
			drawCenteredText(
				`-${formatMoney(discountAmount)}`,
				xTotal + totalWidth - 2,
				rowY,
				rowHeight,
				{ align: 'right' }
			)

			y += rowHeight
		}
	}

	// ========================================================
	// SHIPPING INFO
	// ========================================================

	const drawShippingInfo = () => {
		if (!PDF_LAYOUT.shipping.show) return

		const externalGroups = data.externalGroups ?? []
		if (externalGroups.length === 0) return

		const delivery = calculateEstimatedDelivery(externalGroups)
		if (!delivery) return

		const shippingText = `${PDF_LAYOUT.shipping.label} ${PDF_LAYOUT.shipping.deliveryLabel} ${delivery.text}.`

		setFont(PDF_LAYOUT.typography.note)

		const maxWidth =
			contentWidth - PDF_LAYOUT.shipping.paddingHorizontal * 2

		const lines = pdf.splitTextToSize(shippingText, maxWidth)
		const lineHeight = PDF_LAYOUT.shipping.lineHeight
		const boxHeight =
			lines.length * lineHeight +
			PDF_LAYOUT.shipping.paddingVertical * 2

		ensureBlockSpace(boxHeight)

		const boxY = y

		pdf.setFillColor(
			PDF_LAYOUT.shipping.backgroundColor,
			PDF_LAYOUT.shipping.backgroundColor,
			PDF_LAYOUT.shipping.backgroundColor
		)

		pdf.setDrawColor(...BORDER)
		pdf.setLineWidth(OUTER_LINE)

		pdf.rect(margin, boxY, contentWidth, boxHeight, 'FD')

		setFont(PDF_LAYOUT.typography.note)
		pdf.setTextColor(...PDF_LAYOUT.shipping.textColor)

		let textY =
			boxY +
			PDF_LAYOUT.shipping.paddingVertical +
			lineHeight / 2

		lines.forEach((line) => {
			pdf.text(line, margin + contentWidth / 2, textY, {
				align: 'center',
				baseline: 'middle',
			})

			textY += lineHeight
		})

		y += boxHeight + PDF_LAYOUT.shipping.gapAfter
	}

	// ========================================================
	// NOTES
	// ========================================================

	const drawNotes = () => {
		const noteText = (data.note ?? '').trim()
		if (!noteText) return

		const maxWidth = contentWidth - 8

		pdf.setFont('helvetica', 'bolditalic')
		pdf.setFontSize(PDF_LAYOUT.typography.note)

		const lines: string[] = pdf.splitTextToSize(noteText, maxWidth)
		const lineHeight = PDF_LAYOUT.notes.lineHeight
		const boxHeight = lines.length * lineHeight + PDF_LAYOUT.notes.paddingVertical

		ensureBlockSpace(boxHeight)

		const boxY = y

		// Background and border
		pdf.setFillColor(255, 255, 255)
		pdf.setDrawColor(...BORDER)
		pdf.setLineWidth(OUTER_LINE)
		pdf.rect(margin, boxY, contentWidth, boxHeight, 'FD')

		// Text style
		pdf.setTextColor(...NOTE_RED)
		pdf.setFont('helvetica', 'bolditalic')
		pdf.setFontSize(PDF_LAYOUT.typography.note)

		// Center horizontally and vertically
		const centerX = margin + contentWidth / 2
		const totalTextHeight = lines.length * lineHeight
		let noteY = boxY + (boxHeight - totalTextHeight) / 2 + lineHeight / 2

		lines.forEach((line) => {
			pdf.text(line, centerX, noteY, {
				align: 'center',
				baseline: 'middle',
			})
			noteY += lineHeight
		})

		y += boxHeight
	}

	// ========================================================
	// CTL TABLE
	// ========================================================

	const ctlPriceWidth = 31
	const ctlTotalWidth = 31

	const ctlDescWidth = contentWidth - ctlPriceWidth - ctlTotalWidth

	const xCtlDesc = margin
	const xCtlPrice = xCtlDesc + ctlDescWidth
	const xCtlTotal = xCtlPrice + ctlPriceWidth

	const drawCtlTable = () => {
		if (ctlItems.length === 0) return

		let estimated =
			PDF_LAYOUT.ctl.headerHeight +
			PDF_LAYOUT.ctl.totalHeight +
			PDF_LAYOUT.ctl.highlightHeight

		ctlItems.forEach((item) => {
			estimated += PDF_LAYOUT.ctl.itemHeight

			if (item.note) {
				setFont(6.2, false, true)

				const noteLines = pdf.splitTextToSize(
					item.note,
					ctlDescWidth - 4
				)

				estimated += Math.max(
					PDF_LAYOUT.ctl.noteMinHeight,
					noteLines.length * PDF_LAYOUT.ctl.noteLineHeight +
					PDF_LAYOUT.ctl.notePadding
				)
			}
		})

		ensureBlockSpace(estimated)

		const barHeight = PDF_LAYOUT.ctl.headerHeight
		const barY = y

		pdf.setFillColor(...BLUE)
		pdf.rect(margin, barY, contentWidth, barHeight, 'F')

		pdf.setTextColor(255, 255, 255)
		pdf.setFont('helvetica', 'bold')
		pdf.setFontSize(7)

		drawCenteredText(
			'Consumables / Transportation / Labor Cost (CTL Cost)',
			xCtlDesc + 2,
			barY,
			barHeight
		)

		drawCenteredText(
			'Price THB/ unit',
			xCtlPrice + ctlPriceWidth / 2,
			barY,
			barHeight,
			{ align: 'center' }
		)

		drawCenteredText(
			'Total',
			xCtlTotal + ctlTotalWidth / 2,
			barY,
			barHeight,
			{ align: 'center' }
		)

		y += barHeight

		const drawRow = (
			rowHeight: number,
			withDivider: boolean,
			draw: (centerY: number, rowY: number) => void
		) => {
			const rowY = y
			const centerY = getCenterY(rowY, rowHeight)

			pdf.setDrawColor(...BORDER)
			pdf.setLineWidth(INNER_LINE)

			pdf.rect(margin, rowY, contentWidth, rowHeight)

			if (withDivider) {
				pdf.line(
					xCtlPrice,
					rowY,
					xCtlPrice,
					rowY + rowHeight
				)

				pdf.line(
					xCtlTotal,
					rowY,
					xCtlTotal,
					rowY + rowHeight
				)
			}

			draw(centerY, rowY)

			y += rowHeight
		}

		ctlItems.forEach((item) => {
			const rowHeight = PDF_LAYOUT.ctl.itemHeight

			drawRow(rowHeight, true, (centerY) => {
				setFont(6.8, true)

				pdf.text(item.label, xCtlDesc + 2, centerY, {
					baseline: 'middle',
				})

				pdf.text(
					formatMoney(item.price),
					xCtlPrice + ctlPriceWidth - 2,
					centerY,
					{ align: 'right', baseline: 'middle' }
				)

				pdf.text(
					formatMoney(item.total),
					xCtlTotal + ctlTotalWidth - 2,
					centerY,
					{ align: 'right', baseline: 'middle' }
				)
			})

			if (item.note) {
				setFont(6.2, false, true)

				const noteLines = pdf.splitTextToSize(
					item.note,
					ctlDescWidth - 4
				)

				const noteRowHeight = Math.max(
					PDF_LAYOUT.ctl.noteMinHeight,
					noteLines.length * PDF_LAYOUT.ctl.noteLineHeight +
					PDF_LAYOUT.ctl.notePadding
				)

				drawRow(noteRowHeight, true, (_centerY, rowY) => {
					setFont(6.2, false, true)

					drawCenteredTextBlock(
						noteLines,
						xCtlDesc + 2,
						rowY,
						noteRowHeight,
						PDF_LAYOUT.ctl.noteLineHeight
					)
				})
			}
		})

		drawRow(PDF_LAYOUT.ctl.totalHeight, true, (centerY) => {
			setFont(6.8)

			pdf.text('CTL Total:', xCtlPrice - 2, centerY, {
				align: 'right',
				baseline: 'middle',
			})

			setFont(6.8, true)

			pdf.text(
				formatMoney(ctlTotal),
				xCtlTotal + ctlTotalWidth - 2,
				centerY,
				{ align: 'right', baseline: 'middle' }
			)
		})

		pdf.setFillColor(...LIGHT_BLUE_FILL)
		pdf.rect(
			margin,
			y,
			contentWidth,
			PDF_LAYOUT.ctl.highlightHeight,
			'F'
		)

		y += PDF_LAYOUT.ctl.highlightHeight
	}

	// ========================================================
	// SUMMARY
	// ========================================================

	const drawSummary = () => {
		const summaryWidth = ctlPriceWidth + ctlTotalWidth
		const rowHeight = PDF_LAYOUT.summary.rowHeight
		const x = pageWidth - margin - summaryWidth

		const summaryRows: [string, string, boolean][] = [
			['Total', formatMoney(subtotal + shippingTotal + importTaxTotal), false],
			[
				'Total Discount',
				discountAmount === 0 ? '-' : `- ${formatMoney(discountAmount)}`,
				false,
			],
			['Total Exc. VAT', formatMoney(totalExcVat), true],
			['VAT 7%', formatMoney(vat), true],
			['Total Due', formatMoney(totalDue), true],
		]

		const blockHeight =
			summaryRows.length * rowHeight + PDF_LAYOUT.summary.bottomSpacing

		ensureBlockSpace(blockHeight)

		const startY = y

		pdf.setFillColor(...LIGHT_BLUE_FILL)
		pdf.setDrawColor(...BORDER)
		pdf.setLineWidth(OUTER_LINE)

		pdf.rect(x, startY, summaryWidth, summaryRows.length * rowHeight, 'FD')

		// เส้นแบ่งแนวตั้งกลาง
		pdf.setLineWidth(INNER_LINE)
		pdf.line(
			x + ctlPriceWidth,
			startY,
			x + ctlPriceWidth,
			startY + summaryRows.length * rowHeight
		)

		summaryRows.forEach(([label, value, bold], index) => {
			const rowY = startY + index * rowHeight

			if (index > 0) {
				pdf.setLineWidth(INNER_LINE)
				pdf.line(x, rowY, x + summaryWidth, rowY)
			}

			setFont(PDF_LAYOUT.typography.summary, bold)

			drawCenteredText(label, x + 3, rowY, rowHeight)

			drawCenteredText(
				value,
				x + summaryWidth - 3,
				rowY,
				rowHeight,
				{ align: 'right' }
			)
		})

		y = startY + summaryRows.length * rowHeight + PDF_LAYOUT.summary.bottomSpacing
	}

	// ========================================================
	// PAGE FOOTER
	// ========================================================

	const drawSignature = (footerTop: number) => {
		const signatureX = pageWidth - margin - 73
		const columnWidth = 27
		const gap = 15
		const rightX = signatureX + columnWidth + gap
		const topY = footerTop

		setFont(6.8, true)

		pdf.text('Prepared by', signatureX, topY)
		pdf.text('Approved by', rightX, topY)

		setFont(6.2)

		pdf.text(
			'(..............................................)',
			signatureX,
			topY + 8
		)

		pdf.text(
			'(..............................................)',
			rightX,
			topY + 8
		)

		pdf.text(`Date: .........................................`, signatureX, topY + 13)
		pdf.text(`Date: .........................................`, rightX, topY + 13)

		const customerY = topY + 25

		setFont(6.8, true)

		pdf.text(
			'Customer Acceptance',
			signatureX,
			customerY
		)

		setFont(6.2)

		pdf.text(
			'(..............................................)',
			signatureX,
			customerY + 8
		)

		pdf.text(
			`Date: .........................................`,
			signatureX,
			customerY + 13
		)
	}

	const drawPageFooter = () => {
		const footerTop =
			pageHeight - FOOTER_BOTTOM - FOOTER_HEIGHT

		let fy = footerTop

		drawSignature(footerTop)

		pdf.setTextColor(...NOTE_RED)
		pdf.setFont('helvetica', 'bold')
		pdf.setFontSize(10)

		pdf.text('Payment Terms:', margin, fy)
		fy += 5

		setFont(8)

		pdf.text(
			`- Full payment is needed to confirm the order. (${formatMoney(totalDue)} THB)`,
			margin + 2,
			fy
		)

		fy += 4

		pdf.setTextColor(...NOTE_RED)
		pdf.setFont('helvetica', 'bold')
		pdf.setFontSize(10)

		pdf.text('Remarks:', margin, fy)
		fy += 5

		setFont(8)

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
			const lines = pdf.splitTextToSize(
				`- ${remark}`,
				contentWidth
			)

			pdf.text(lines, margin + 2, fy)
			fy += lines.length * 3.5 + 1
		})

		fy += 3

		const boxHeight = PDF_LAYOUT.bank.boxHeight
		const boxY = fy
		const contentX =
			margin + PDF_LAYOUT.bank.paddingHorizontal

		pdf.setDrawColor(...BORDER)
		pdf.setLineWidth(OUTER_LINE)

		pdf.rect(
			margin,
			boxY,
			contentWidth,
			boxHeight
		)

		setFont(10, true)

		pdf.text(
			'Bank Information:',
			contentX,
			boxY + PDF_LAYOUT.bank.paddingTop
		)

		setFont(8)

		const bank = BANKS[data.companyCode]
		const bankLines = [
			`Bank Name : ${bank.bankName} (${bank.branch})`,
			`Bank Address : ${bank.bankAddress}`,
			`A/C Name : ${bank.accountName}`,
			`A/C No : ${bank.accountNo} (Savings Account)   ;   Swift code : ${bank.swift}`,
			`Address : ${bank.address}`,
			`Tel : ${bank.tel}`,
		]

		const firstLineY =
			boxY +
			PDF_LAYOUT.bank.paddingTop +
			PDF_LAYOUT.bank.titleSpacing

		bankLines.forEach((line, index) => {
			pdf.text(
				line,
				contentX,
				firstLineY + index * PDF_LAYOUT.bank.lineHeight
			)
		})
	}

	// ========================================================
	// DRAW EVERYTHING
	// ========================================================

	drawPageHeader()
	drawCostTable()
	drawShippingInfo()
	drawNotes()
	drawCtlTable()
	drawSummary()

	const pageCount = pdf.getNumberOfPages()

	for (let page = 1; page <= pageCount; page++) {
		pdf.setPage(page)
		drawPageFooter()

		pdf.setTextColor(130, 130, 130)
		pdf.setFont('helvetica', 'normal')
		pdf.setFontSize(5)

		pdf.text(
			`Page ${page} of ${pageCount}`,
			pageWidth - margin,
			pageHeight - 5,
			{ align: 'right' }
		)
	}

	pdf.save(
		`${data.projectName} - ${data.jobDescription || 'draft'}.pdf`
	)
}