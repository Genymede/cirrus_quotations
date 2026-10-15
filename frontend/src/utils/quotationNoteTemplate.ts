// Single quotation-level note -- replaces the old one-sentence-per-box
// notes (see quotationRows.ts's history). Pure text generation, no
// calculation logic: every figure it reads (shippingTotal/importTaxTotal)
// is already computed elsewhere (utils/quotationRows.ts's
// computeQuotationTotals); this module only decides which clauses appear
// in the generated sentence and how they're worded.
//
// The generated text is a *starting point* for an editable textarea (see
// App.tsx) -- this function is never called by the PDF itself, only by
// the screen, on mount and on an explicit "Regenerate" click.

// "a" / "a and b" / "a, b, and c" / "a, b, c, and d" -- the standard
// English list join, used for both the "including ..." item list and the
// "It includes ..." clause.
function joinWithAnd(items: string[]): string {
	if (items.length === 0) return ''
	if (items.length === 1) return items[0]
	if (items.length === 2) return `${items[0]} and ${items[1]}`
	return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}

// {item list} -- names what's actually on the quotation in the opening
// sentence. Caps at 5 named items by treating "other required parts" as a
// synthetic 6th item and handing the whole thing to joinWithAnd -- its own
// Oxford-comma rule then produces "...E, and other required parts" for
// free, matching the task's "first 5, then 'and other required parts'"
// rule without a separate code path.
function buildItemList(itemNames: string[]): string {
	if (itemNames.length === 0) return 'the required parts'
	if (itemNames.length > 5) {
		return joinWithAnd([...itemNames.slice(0, 5), 'other required parts'])
	}
	return joinWithAnd(itemNames)
}

export type QuotationNoteInput = {
	jobDescription: string
	shippingTotal: number
	importTaxTotal: number
	// "The quotation has labour cost in CTL" -- the CTL Labour line is
	// both included and has a nonzero price. Drives both the "and
	// installation" clause and the "installation labor" list item (the
	// task's own rule: the same condition governs both).
	hasLabour: boolean
	// Names of what's actually on the quotation, in table order -- stock
	// items (their quotation-level name, including user edits) and
	// external parts on the quotation (fully-stocked parts already
	// excluded by the caller, same as everywhere else in this codebase).
	// Never shipping/import-tax/CTL lines. Caller (App.tsx) derives this
	// from the same buildQuotationRows output the table itself renders,
	// so this list can never drift from what the customer actually sees.
	itemNames: string[]
}

export function generateQuotationNote({
	jobDescription,
	shippingTotal,
	importTaxTotal,
	hasLabour,
	itemNames,
}: QuotationNoteInput): string {
	const installationClause = hasLabour ? ' and installation' : ''
	const description = jobDescription.trim() || 'the items in this quotation'

	const included: string[] = []
	if (shippingTotal > 0) included.push('estimated shipping costs')
	included.push('7% VAT')
	if (importTaxTotal > 0) included.push('import duty')
	if (hasLabour) included.push('installation labor')

	return (
		`Note: This quotation covers the purchase of ${description}. ` +
		`It includes ${joinWithAnd(included)}. ` +
		'Customs clearance, additional transportation, and any extra costs, labor, or spare parts ' +
		'beyond the scope of this quotation will be charged separately. ' +
		"Warranty is subject to the manufacturer's terms."
	)
}
