const { buildGroupsAndLines } = require('./buildLines')

function isUuid(v) {
  return !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
}

function addOneMonth(dateString) {
  const [year, month, day] = dateString.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCMonth(date.getUTCMonth() + 1)
  return date.toISOString().slice(0, 10)
}

async function saveQuotation(client, input, userId, generateNumber) {
  if (!isUuid(input.clientId)) throw new Error('valid clientId is required')
  if (!input.issueDate) throw new Error('issueDate is required')
  if (!isUuid(userId)) throw new Error('valid created_by userId is required')

  const isUpdate = isUuid(input.id)
  let quotationId
  let number
  let status = input.status || 'draft'

  const partsSubtotal = Number(input.partsSubtotal) || 0
  console.log('SAVE QUOTATION partsSubtotal:', input.partsSubtotal, '=>', partsSubtotal)
  const shippingTotal = Number(input.shippingTotal) || 0
  const importTaxTotal = Number(input.importTaxTotal) || 0
  const ctlTotal = Number(input.ctlTotal) || 0
  const discountValue = Number(input.discountValue) || 0
  const discountAmount = Math.round(partsSubtotal * (discountValue / 100) * 100) / 100
  const total = Math.round((partsSubtotal - discountAmount + shippingTotal + importTaxTotal + ctlTotal) * 100) / 100

  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
  }).format(new Date())

  const validUntil = addOneMonth(today)

  if (isUpdate) {
    quotationId = input.id

    const existing = await client.query(
      `SELECT id, number, status FROM sales.quotations WHERE id = $1 FOR UPDATE`,
      [quotationId],
    )

    if (!existing.rows[0]) throw new Error('Quotation ' + quotationId + ' not found')

    number = (input.number && input.number.trim()) || existing.rows[0].number
    status = input.status || existing.rows[0].status

    await client.query(
      `UPDATE sales.quotations SET
        number=$2,
        client_id=$3,
        issue_date=$4,
        valid_until=$5,
        status=$6,
        discount_type=$7,
        discount_value=$8,
        tax_rate=$9,
        currency=$10,
        notes=$11,
        terms=$12,
        project_id=$13,
        description=$14,
        parts_subtotal=$15,
        shipping_total=$16,
        import_tax_total=$17,
        ctl_total=$18,
        discount_amount=$19,
        tax_amount=$20,
        total=$21,
        ctl_items=$22::jsonb,
        external_groups='[]'::jsonb,
        sent_at=CASE
          WHEN $6::sales.quotation_status='sent' AND sent_at IS NULL THEN now()
          ELSE sent_at
        END,
        accepted_at=CASE
          WHEN $6::sales.quotation_status='accepted' AND accepted_at IS NULL THEN now()
          ELSE accepted_at
        END,
        updated_at=now()
      WHERE id=$1`,
      [
        quotationId,
        number,
        input.clientId,
        input.issueDate,
        input.validUntil || null,
        status,
        input.discountType || null,
        input.discountValue != null ? input.discountValue : null,
        input.taxRate != null ? input.taxRate : 7,
        input.currency || 'THB',
        input.notes || null,
        input.terms || null,
        isUuid(input.projectId) ? input.projectId : null,
        //isUuid(input.workOrderId) ? input.workOrderId : null,
        input.description || null,
        partsSubtotal,
        shippingTotal,
        importTaxTotal,
        ctlTotal,
        discountAmount,
        0,
        total,
        JSON.stringify(input.ctlItems || []),
      ],
    )

    await client.query(`DELETE FROM sales.quotation_lines WHERE quotation_id=$1`, [quotationId])
    await client.query(`DELETE FROM sales.quotation_external_groups WHERE quotation_id=$1`, [quotationId])
  } else {
    number = await generateNumber(client, today)

    console.log('INSERT VALUES:', [
      number,
      input.clientId,
      today,
      input.validUntil || null,
      status,
      partsSubtotal,
      input.discountType || null,
      input.discountValue != null ? input.discountValue : null,
      input.taxRate != null ? input.taxRate : 7,
      input.currency || 'THB',
      input.notes || null,
      input.terms || null,
      isUuid(input.projectId) ? input.projectId : null,
      input.description || null,
      partsSubtotal,
      shippingTotal,
      importTaxTotal,
      ctlTotal,
      discountAmount,
      0,
      total,
      JSON.stringify(input.ctlItems || []),
      userId,
    ])

    const inserted = await client.query(
      `INSERT INTO sales.quotations (
        number,
        client_id,
        issue_date,
        valid_until,
        status,
        subtotal,
        discount_type,
        discount_value,
        tax_rate,
        currency,
        notes,
        terms,
        project_id,
        description,
        parts_subtotal,
        shipping_total,
        import_tax_total,
        ctl_total,
        discount_amount,
        tax_amount,
        total,
        ctl_items,
        external_groups,
        created_by,
        sent_at,
        accepted_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
        $22::jsonb,'[]'::jsonb,$23,
        CASE WHEN $5::sales.quotation_status='sent' THEN now() ELSE NULL END,
        CASE WHEN $5::sales.quotation_status='accepted' THEN now() ELSE NULL END
      )
      RETURNING id, number, subtotal, parts_subtotal, shipping_total, import_tax_total, ctl_total, total`,
      [
        number,
        input.clientId,
        today,
        validUntil,
        status,
        partsSubtotal,
        input.discountType || null,
        input.discountValue != null ? input.discountValue : null,
        input.taxRate != null ? input.taxRate : 7,
        input.currency || 'THB',
        input.notes || null,
        input.terms || null,
        isUuid(input.projectId) ? input.projectId : null,
        input.description || null,
        partsSubtotal,
        shippingTotal,
        importTaxTotal,
        ctlTotal,
        discountAmount,
        0,
        total,
        JSON.stringify(input.ctlItems || []),
        userId,
      ],
    )

    console.log('DB RETURNING:', inserted.rows[0])
    quotationId = inserted.rows[0].id
  }

  const built = buildGroupsAndLines(input)
  const groupIdMap = {}
  const partIdMap = {}

  for (let gi = 0; gi < built.groups.length; gi++) {
    const g = built.groups[gi]

    const gRow = await client.query(
      `INSERT INTO sales.quotation_external_groups (
    quotation_id, source_type, source_name, brand, country, currency,
    exchange_rate, shipping_cost, import_tax, estimated_delivery, warranty,
    installation_included, contains_stock_items, purchase_order_id,
    po_number_snapshot, shipment_ref, sort_order, notes
  ) VALUES (
    $1, $2::sales.external_source_type, $3, $4, $5, $6,
    $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
  )
  RETURNING id`,
      [
        quotationId,
        g.sourceType,
        g.sourceName,
        g.brand || null,
        g.country,
        g.currency,
        g.exchangeRate,
        g.shippingCost,
        g.importTax,
        g.estimatedDelivery,
        g.warranty,
        g.installationIncluded,
        g.containsStockItems,
        isUuid(g.purchaseOrderId) ? g.purchaseOrderId : null,
        g.poNumberSnapshot || null,
        g.shipmentRef || null,
        g.sortOrder,
        g.notes || null,
      ],
    )

    const dbGroupId = gRow.rows[0].id
    groupIdMap[g.clientId] = dbGroupId

    for (let pi = 0; pi < g.parts.length; pi++) {
      const p = g.parts[pi]

      const pRow = await client.query(
        `INSERT INTO sales.quotation_external_parts (
          id, group_id, part_name, qty, unit,
          unit_cost, unit_cost_thb, markup_percent,
          price_before_vat, vat_rate, vat_amount, unit_price,
          unit_weight, has_stock_portion, stock_qty, sort_order
        ) VALUES (
          gen_random_uuid(), $1, $2, $3, $4,
          $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
        )
        RETURNING id`,
        [
          dbGroupId,
          p.partName,
          p.qty,
          p.unit,
          p.unitCost,
          p.unitCostThb,
          p.markupPercent,
          Math.round((Number(p.unitCostThb) * (1 + Number(p.markupPercent) / 100)) * 100) / 100,
          Number(p.vatPercent) || 0,
          Math.round((Number(p.unitPrice) - (Number(p.unitCostThb) * (1 + Number(p.markupPercent) / 100))) * 100) / 100,
          p.unitPrice,
          p.unitWeight,
          p.hasStockPortion,
          p.stockQty,
          p.sortOrder,
        ],
      )

      partIdMap[p.clientId] = pRow.rows[0].id
    }
  }

  for (let li = 0; li < built.lines.length; li++) {
    const line = built.lines[li]

    await client.query(
      `INSERT INTO sales.quotation_lines (
        quotation_id, item_id, description, quantity, unit_price, sort_order,
        line_type, unit, brand, part_no,
        unit_cost, unit_cost_foreign, currency, exchange_rate, markup_percent,
        external_group_id, external_part_id, ctl_key, line_notes
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7::sales.quotation_line_type,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18,$19
      )`,
      [
        quotationId,
        isUuid(line.itemId) ? line.itemId : null,
        line.description,
        line.quantity,
        line.unitPrice,
        line.sortOrder,
        line.lineType,
        line.unit,
        line.brand,
        line.partNo,
        line.unitCost,
        line.unitCostForeign,
        line.currency,
        line.exchangeRate,
        line.markupPercent,
        line.externalGroupClientId ? (groupIdMap[line.externalGroupClientId] || null) : null,
        line.externalPartClientId ? (partIdMap[line.externalPartClientId] || null) : null,
        line.ctlKey,
        line.lineNotes,
      ],
    )
  }

  const check = await client.query(
    `SELECT id, number, subtotal, parts_subtotal, shipping_total, import_tax_total, ctl_total, total
     FROM sales.quotations
     WHERE id = $1`,
    [quotationId],
  )

  console.log('DB BEFORE RETURN:', check.rows[0])

  return { id: quotationId, number, status }
}

module.exports = { saveQuotation }