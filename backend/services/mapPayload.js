function mapAppBodyToSaveInput(body) {
  let ctlItems = []

  if (body.ctlState && typeof body.ctlState === 'object') {
    ctlItems = Object.entries(body.ctlState).map(([key, row]) => ({
      key,
      label: key,
      included: !!row.included,
      price: Number(row.price) || 0,
      total: Number(row.price) || 0,
      note: row.note,
      days: row.days,
      technicians: row.technicians,
      dayDescriptions: row.dayDescriptions,
    }))
  } else {
    ctlItems = (body.ctlItems || []).map((c, i) => ({
      key: 'ctl_' + i,
      label: c.label,
      included: true,
      price: Number(c.price) || 0,
      total: Number(c.total != null ? c.total : c.price) || 0,
      note: c.note,
    }))
  }

  return {
    id: body.quotationId || null,
    number: body.quotationNo || null,
    status: body.status || 'draft',
    clientId: body.clientId || null,
    clientName: body.customerName,
    clientEmail: body.clientEmail || null,
    clientAddress: body.clientAddress || null,
    projectId: body.projectId || null,
    projectName: body.projectName || null,
    description: body.description || null,
    issueDate: body.quotationDate,
    validUntil: body.validUntil || null,
    discountType: 'percent',
    discountValue: Number(body.discountPercent) || 0,
    taxRate: 7,
    currency: 'THB',
    notes: body.note || null,
    terms: body.terms || null,
    stockItems: (body.items || []).map((item) => ({
      id: item.id,
      itemId: item.itemId || null,
      partName: item.partName,
      partNo: item.partNo,
      brand: item.brand,
      qty: item.qty,
      unit: item.unit,
      unitPrice: item.unitPrice,
      unitCost: item.unitCost != null ? item.unitCost : null,
      markupPercent: item.markupPercent != null ? item.markupPercent : null,
    })),
    externalGroups: body.externalGroups || [],
    ctlItems,
    partsSubtotal: Number(body.totals && body.totals.subtotal) || 0,
    shippingTotal: Number(body.totals && body.totals.shippingTotal) || 0,
    importTaxTotal: Number(body.totals && body.totals.importTaxTotal) || 0,
    ctlTotal: Number(body.totals && body.totals.ctlTotal) || 0,
  }
}

module.exports = { mapAppBodyToSaveInput }