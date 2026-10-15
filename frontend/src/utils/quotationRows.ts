import {
	getQuotationParts,
	customerShippingForQuotation,
	shouldShowShippingLine,
	importTaxForQuotation,
	type ExternalGroup,
	type QuotationPart,
	type ShippingRule,
} from './externalPartsAllocation'
import { roundMoney } from './money'

export type QuotationStockItem = {
	id: string
	partName: string
	qty: number
	unit: string
	unitPrice: number
}

export type ExternalGroupScreenRow = {
	kind: 'external-group'
	group: ExternalGroup
	badgeOrigin: string
	parts: QuotationPart[]
	shippingLabel: string
	shippingAmount: number
}

export type ScreenRow<TStockItem extends QuotationStockItem = QuotationStockItem> =
	| { kind: 'stock'; item: TStockItem }
	| { kind: 'external-group'; group: ExternalGroup; badgeOrigin: string; parts: QuotationPart[] }
	| { kind: 'import-tax'; amount: number }

export type PdfRow<TStockItem extends QuotationStockItem = QuotationStockItem> =
	| { kind: 'stock'; item: TStockItem }
	| { kind: 'external-part'; part: QuotationPart; brand: string }
	| { kind: 'external-shipping'; label: string; amount: number; brand: string }
	| { kind: 'import-tax'; amount: number; brand: string }

export type QuotationRows<TStockItem extends QuotationStockItem = QuotationStockItem> = {
	screenRows: ScreenRow<TStockItem>[]
	pdfRows: PdfRow<TStockItem>[]
}

function combinedImportTaxTotal(externalGroups: ExternalGroup[]): number {
	return externalGroups.reduce(
		(sum, group) => sum + importTaxForQuotation(group),
		0
	)
}

function normalizeKey(value: string): string {
	return value.trim().toLowerCase()
}

type AggregatedBrand = {
	brand: string
	parts: Map<string, QuotationPart>
	shipping: number
	importTax: number
}

function addPartToMap(
	partMap: Map<string, QuotationPart>,
	part: QuotationPart
): void {
	const key = normalizeKey(part.partName)
	const existing = partMap.get(key)

	if (!existing) {
		partMap.set(key, { ...part })
		return
	}

	existing.qty += part.qty
	existing.quotationQty += part.quotationQty
}

export function buildQuotationRows<TStockItem extends QuotationStockItem>(
	items: TStockItem[],
	externalGroups: ExternalGroup[],
	shippingRule: ShippingRule
): QuotationRows<TStockItem> {
	const screenRows: ScreenRow<TStockItem>[] = []
	const pdfRows: PdfRow<TStockItem>[] = []

	for (const item of items) {
		screenRows.push({
			kind: 'stock',
			item,
		})

		pdfRows.push({
			kind: 'stock',
			item,
		})
	}

	const noBrandParts = new Map<string, QuotationPart>()
	let noBrandShipping = 0
	let noBrandImportTax = 0

	const brandedGroups = new Map<string, AggregatedBrand>()

	for (const group of externalGroups) {
		const quotationParts = getQuotationParts(group.parts)
		const badgeOrigin = group.country.trim() || group.sourceName.trim()

		screenRows.push({
			kind: 'external-group',
			group,
			badgeOrigin,
			parts: quotationParts,
		})

		const brand = group.brand.trim()
		const brandKey = normalizeKey(brand)

		if (!brand) {
			for (const part of quotationParts) {
				addPartToMap(noBrandParts, part)
			}

			if (shouldShowShippingLine(group)) {
				noBrandShipping += customerShippingForQuotation(group, shippingRule)
			}

			noBrandImportTax += importTaxForQuotation(group)
			continue
		}

		let brandData = brandedGroups.get(brandKey)

		if (!brandData) {
			brandData = {
				brand,
				parts: new Map(),
				shipping: 0,
				importTax: 0,
			}

			brandedGroups.set(brandKey, brandData)
		}

		for (const part of quotationParts) {
			addPartToMap(brandData.parts, part)
		}

		if (shouldShowShippingLine(group)) {
			brandData.shipping += customerShippingForQuotation(group, shippingRule)
		}

		brandData.importTax += importTaxForQuotation(group)
	}

	for (const part of noBrandParts.values()) {
		pdfRows.push({
			kind: 'external-part',
			part,
			brand: '',
		})
	}

	if (noBrandShipping > 0) {
		pdfRows.push({
			kind: 'external-shipping',
			label: 'Estimated Shipping Cost',
			amount: roundMoney(noBrandShipping),
			brand: '',
		})
	}

	if (noBrandImportTax > 0) {
		pdfRows.push({
			kind: 'import-tax',
			amount: roundMoney(noBrandImportTax),
			brand: '',
		})
	}

	for (const brandData of brandedGroups.values()) {
		for (const part of brandData.parts.values()) {
			pdfRows.push({
				kind: 'external-part',
				part,
				brand: brandData.brand,
			})
		}

		if (brandData.shipping > 0) {
			pdfRows.push({
				kind: 'external-shipping',
				label: `Estimated Shipping Cost (From ${brandData.brand})`,
				amount: roundMoney(brandData.shipping),
				brand: brandData.brand,
			})
		}

		if (brandData.importTax > 0) {
			pdfRows.push({
				kind: 'import-tax',
				amount: roundMoney(brandData.importTax),
				brand: brandData.brand,
			})
		}
	}

	const importTaxTotal = combinedImportTaxTotal(externalGroups)

	if (importTaxTotal > 0 && !pdfRows.some((row) => row.kind === 'import-tax')) {
		pdfRows.push({
			kind: 'import-tax',
			amount: importTaxTotal,
			brand: '',
		})
	}

	return { screenRows, pdfRows }
}

export type QuotationTotals = {
	partsSubtotal: number
	shippingTotal: number
	importTaxTotal: number
	discountAmount: number
	totalDue: number
}

export function computeQuotationTotals<TStockItem extends QuotationStockItem>(
	items: TStockItem[],
	externalGroups: ExternalGroup[],
	ctlTotal: number,
	discountPercent: number,
	shippingRule: ShippingRule
): QuotationTotals {
	const stockSubtotal = items.reduce(
		(sum, item) => sum + item.qty * item.unitPrice,
		0
	)

	const externalPartsSubtotal = externalGroups.reduce(
		(sum, group) =>
			sum +
			getQuotationParts(group.parts).reduce(
				(partSum, part) => partSum + part.quotationQty * part.unitPrice,
				0
			),
		0
	)

	const partsSubtotal = stockSubtotal + externalPartsSubtotal

	const shippingTotal = externalGroups.reduce(
		(sum, group) => sum + customerShippingForQuotation(group, shippingRule),
		0
	)

	const importTaxTotal = combinedImportTaxTotal(externalGroups)

	const discountAmount = partsSubtotal * (discountPercent / 100)
	const discountedParts = partsSubtotal - discountAmount

	const totalDue = roundMoney(
		discountedParts + shippingTotal + importTaxTotal + ctlTotal
	)

	return {
		partsSubtotal,
		shippingTotal,
		importTaxTotal,
		discountAmount,
		totalDue,
	}
}