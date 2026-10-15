const express = require('express')
const { pool, withTransaction } = require('../db')
const { mapAppBodyToSaveInput } = require('../services/mapPayload')
const { saveQuotation } = require('../services/saveQuotation')
const { generateQuotationNumber } = require('../services/quotationNumber')
const { resolveDefaultUserId } = require('../services/defaultUser')

const router = express.Router()

router.get('/projects', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        p.id,
        p.name,
        p.client_id AS "clientId",
        c.name AS "clientName"
      FROM projects.projects p
      LEFT JOIN crm.clients c ON c.id = p.client_id
      ORDER BY p.name
    `)

    res.json(rows)
  } catch (err) {
    next(err)
  }
})

router.get('/', async (req, res, next) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : null

    const { rows } = await pool.query(
      `SELECT q.id, q.number, q.status, q.issue_date AS "issueDate", q.valid_until AS "validUntil",
              q.parts_subtotal AS "partsSubtotal", q.shipping_total AS "shippingTotal",
              q.import_tax_total AS "importTaxTotal", q.ctl_total AS "ctlTotal",
              q.subtotal, q.discount_amount AS "discountAmount", q.tax_amount AS "taxAmount",
              q.total, q.currency, q.client_id AS "clientId", c.name AS "customerName",
              c.company_name AS "customerCompany", q.project_id AS "projectId",
              p.name AS "projectName", q.description,
              q.created_at AS "createdAt", q.updated_at AS "updatedAt"
       FROM sales.quotations q
       LEFT JOIN crm.clients c ON c.id = q.client_id
       LEFT JOIN projects.projects p ON p.id = q.project_id
       WHERE ($1::text IS NULL OR q.status::text = $1)
       ORDER BY q.issue_date DESC, q.created_at DESC
       LIMIT 200`,
      [status],
    )

    res.json(rows)
  } catch (err) {
    next(err)
  }
})

router.get('/:id', async (req, res, next) => {
  try {
    const id = req.params.id

    const header = await pool.query(
      `SELECT * FROM sales.quotations WHERE id = $1`,
      [id],
    )

    if (!header.rows[0]) {
      return res.status(404).json({ error: 'Quotation not found' })
    }

    const quotation = header.rows[0]

    const [groups, lines, client, project] = await Promise.all([
      pool.query(
        `SELECT * FROM sales.quotation_external_groups
     WHERE quotation_id = $1
     ORDER BY sort_order, created_at`,
        [id],
      ),
      pool.query(
        `SELECT * FROM sales.quotation_lines
     WHERE quotation_id = $1
     ORDER BY sort_order, created_at`,
        [id],
      ),
      pool.query(
        `SELECT id, name, company_name, email, phone, address, city, country
     FROM crm.clients
     WHERE id = $1`,
        [quotation.client_id],
      ),
      pool.query(
        `SELECT id, name, description, status, priority, color, start_date, due_date, budget, client_id
     FROM projects.projects
     WHERE id = $1`,
        [quotation.project_id],
      ),
    ])

    const groupIds = groups.rows.map((g) => g.id)

    let parts = { rows: [] }

    if (groupIds.length) {
      parts = await pool.query(
        `SELECT * FROM sales.quotation_external_parts
         WHERE group_id = ANY($1::uuid[])
         ORDER BY sort_order, created_at`,
        [groupIds],
      )
    }

    res.json({
      quotation,
      customer: client.rows[0] || null,
      project: project.rows[0] || null,
      externalGroups: groups.rows,
      externalParts: parts.rows,
      lines: lines.rows,
      ctlItems: quotation.ctl_items || [],
    })
  } catch (err) {
    next(err)
  }
})

router.post('/', async (req, res, next) => {
  try {
    const body = req.body
    if (!body || !body.customerName || !String(body.customerName).trim()) {
      return res.status(400).json({ error: 'customerName is required' })
    }
    if (!body.quotationDate) {
      return res.status(400).json({ error: 'quotationDate is required' })
    }

    const userId = await resolveDefaultUserId()
    const input = mapAppBodyToSaveInput(Object.assign({}, body, { quotationId: undefined }))
    const result = await withTransaction((client) =>
      saveQuotation(client, input, userId, () => generateQuotationNumber(client)),
    )
    res.status(201).json(result)
  } catch (err) {
    next(err)
  }
})

router.put('/:id', async (req, res, next) => {
  try {
    const userId = await resolveDefaultUserId()
    const input = mapAppBodyToSaveInput(
      Object.assign({}, req.body, { quotationId: req.params.id }),
    )
    const result = await withTransaction((client) =>
      saveQuotation(client, input, userId, () => generateQuotationNumber(client)),
    )
    res.json(result)
  } catch (err) {
    next(err)
  }
})

router.patch('/:id/status', async (req, res) => {
  const { id } = req.params
  const { status } = req.body

  const allowedStatuses = ['draft', 'sent', 'accepted', 'rejected', 'expired']

  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({
      error: 'Invalid quotation status',
    })
  }

  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    const result = await client.query(
      `UPDATE sales.quotations
       SET
         status = $2::sales.quotation_status,
         sent_at = CASE
           WHEN $2::sales.quotation_status = 'sent' AND sent_at IS NULL THEN now()
           ELSE sent_at
         END,
         accepted_at = CASE
           WHEN $2::sales.quotation_status = 'accepted' AND accepted_at IS NULL THEN now()
           ELSE accepted_at
         END,
         updated_at = now()
       WHERE id = $1
       RETURNING id, number, status, sent_at, accepted_at`,
      [id, status],
    )

    if (!result.rows[0]) {
      await client.query('ROLLBACK')

      return res.status(404).json({
        error: 'Quotation not found',
      })
    }

    await client.query('COMMIT')

    res.json({
      quotation: result.rows[0],
    })
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('Failed to update quotation status:', error)

    res.status(500).json({
      error: 'Failed to update quotation status',
    })
  } finally {
    client.release()
  }
})

module.exports = router