const { randomUUID } = require('crypto')

function ensureId(id) {
  if (id && /^[0-9a-f-]{36}$/i.test(id)) return id
  return randomUUID()
}

function quotationQty(part) {
  if (!part.hasStockPortion) return part.qty
  return Math.max(0, part.qty - part.stockQty)
}

function buildGroupsAndLines(input) {
  const groups = []
  const lines = []
  let sortOrder = 0

    ; (input.stockItems || []).forEach((item) => {
      lines.push({
        lineType: 'stock',
        itemId: item.itemId || null,
        description: String(item.partName || '').trim(),
        quantity: item.qty,
        unitPrice: item.unitPrice,
        sortOrder: sortOrder++,
        unit: item.unit || null,
        brand: item.brand || null,
        partNo: item.partNo || null,
        unitCost: item.unitCost != null ? item.unitCost : null,
        unitCostForeign: null,
        currency: 'THB',
        exchangeRate: 1,
        markupPercent: item.markupPercent != null ? item.markupPercent : null,
        externalGroupClientId: null,
        externalPartClientId: null,
        ctlKey: null,
        lineNotes: null,
      })
    })

    ; (input.externalGroups || []).forEach((group, gIndex) => {
      const groupClientId = ensureId(group.id)
      const parts = (group.parts || []).map((p, pIndex) => ({
        clientId: ensureId(p.id),
        partName: String(p.partName || '').trim(),
        qty: p.qty,
        unit: p.unit || '',
        unitCost: p.unitCost || 0,
        unitCostThb: p.unitCostTHB != null ? p.unitCostTHB : (p.unitCostThb || 0),
        markupPercent: p.markupPercent != null ? p.markupPercent : 0,
        vatPercent: p.vatPercent != null ? p.vatPercent : 0,
        unitPrice: p.unitPrice || 0,
        unitWeight: p.unitWeight || 0,
        hasStockPortion: !!p.hasStockPortion,
        stockQty: p.hasStockPortion ? (p.stockQty || 0) : 0,
        sortOrder: pIndex,
      }))

      groups.push({
        clientId: groupClientId,
        sourceType: group.sourceType || 'import',
        sourceName: String(group.sourceName || '').trim(),
        brand: String(group.brand || '').trim(),
        country: String(group.country || '').trim(),
        currency: group.currency || 'THB',
        exchangeRate: group.exchangeRate > 0 ? group.exchangeRate : 1,
        shippingCost: group.shippingCost || 0,
        importTax: group.importTax || 0,
        estimatedDelivery: group.estimatedDelivery || '',
        warranty: group.warranty || '',
        installationIncluded: !!group.installationIncluded,
        containsStockItems: !!group.containsStockItems,
        purchaseOrderId: group.purchaseOrderId || null,
        poNumberSnapshot: group.poNumberSnapshot || null,
        shipmentRef: group.shipmentRef || null,
        sortOrder: gIndex,
        parts,
      })

        ; (group.parts || []).forEach((part) => {
          const qQty = quotationQty(part)
          if (qQty <= 0) return
          lines.push({
            lineType: 'external',
            itemId: null,
            description: String(part.partName || '').trim(),
            quantity: qQty,
            unitPrice: part.unitPrice,
            sortOrder: sortOrder++,
            unit: part.unit || null,
            brand: null,
            partNo: null,
            unitCost: part.unitCostTHB != null ? part.unitCostTHB : (part.unitCostThb || null),
            unitCostForeign: part.unitCost != null ? part.unitCost : null,
            currency: group.currency || 'THB',
            exchangeRate: group.exchangeRate || 1,
            markupPercent: part.markupPercent != null ? part.markupPercent : null,
            externalGroupClientId: groupClientId,
            externalPartClientId: ensureId(part.id),
            ctlKey: null,
            lineNotes: null,
          })
        })

      const hasQuotationParts = (group.parts || []).some((p) => quotationQty(p) > 0)

      if (hasQuotationParts && group.importTax > 0 && group.sourceType === 'import') {
        lines.push({
          lineType: 'import_tax',
          itemId: null,
          description: 'Import Tax',
          quantity: 1,
          unitPrice: group.importTax,
          sortOrder: sortOrder++,
          unit: null,
          brand: null,
          partNo: null,
          unitCost: group.importTax,
          unitCostForeign: null,
          currency: 'THB',
          exchangeRate: 1,
          markupPercent: null,
          externalGroupClientId: groupClientId,
          externalPartClientId: null,
          ctlKey: null,
          lineNotes: null,
        })
      }

      if (hasQuotationParts && group.shippingCost > 0) {
        const origin = (group.country || group.sourceName || 'External').trim()
        lines.push({
          lineType: 'shipping',
          itemId: null,
          description: 'Estimated Shipping Cost (From ' + origin + ')',
          quantity: 1,
          unitPrice: 0,
          sortOrder: sortOrder++,
          unit: null,
          brand: null,
          partNo: null,
          unitCost: group.shippingCost,
          unitCostForeign: null,
          currency: 'THB',
          exchangeRate: 1,
          markupPercent: null,
          externalGroupClientId: groupClientId,
          externalPartClientId: null,
          ctlKey: null,
          lineNotes: 'Customer amount on quotations.shipping_total',
        })
      }
    })

    ; (input.ctlItems || []).forEach((ctl) => {
      if (!ctl.included || !(ctl.price > 0)) return
      const notes = []
      if (ctl.note) notes.push(ctl.note)
      if (ctl.key === 'labour' && ctl.days != null) {
        notes.push(ctl.days + ' Day / ' + (ctl.technicians || 1) + ' Technicians')
          ; (ctl.dayDescriptions || []).forEach((d, i) => {
            if (d && String(d).trim()) notes.push('Day ' + (i + 1) + ': ' + String(d).trim())
          })
      }
      lines.push({
        lineType: 'ctl',
        itemId: null,
        description: ctl.label || ctl.key,
        quantity: 1,
        unitPrice: ctl.total != null ? ctl.total : ctl.price,
        sortOrder: sortOrder++,
        unit: null,
        brand: null,
        partNo: null,
        unitCost: null,
        unitCostForeign: null,
        currency: 'THB',
        exchangeRate: 1,
        markupPercent: null,
        externalGroupClientId: null,
        externalPartClientId: null,
        ctlKey: ctl.key || null,
        lineNotes: notes.length ? notes.join('\n') : null,
      })
    })

  return { groups, lines }
}

module.exports = { buildGroupsAndLines }