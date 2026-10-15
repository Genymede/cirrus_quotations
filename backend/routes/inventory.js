const express = require('express')
const { pool } = require('../db')

const router = express.Router()

router.get('/items', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        i.id, i.part_name AS "partName", COALESCE(i.brand, b.name) AS brand,
        i.part_no AS "partNo", i.item_type AS "itemType", i.barcode,
        i.unit_cost::text AS "unitCost", i.unit_sell_price::text AS "unitSellPrice",
        i.tax_rate::text AS "taxRate", i.is_active AS "isActive", i.notes,
        CASE WHEN u.id IS NULL THEN NULL ELSE json_build_object(
          'id', u.id, 'name', u.name, 'abbreviation', u.abbreviation
        ) END AS unit
      FROM inventory.items i
      LEFT JOIN inventory.units u ON u.id = i.unit_id
      LEFT JOIN inventory.brands b ON b.id = i.brand_id
      WHERE i.is_active = true
      ORDER BY i.part_name
    `)
    res.json(rows)
  } catch (err) {
    next(err)
  }
})

router.get('/items/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT
        i.id, i.part_name AS "partName", COALESCE(i.brand, b.name) AS brand,
        i.part_no AS "partNo", i.item_type AS "itemType", i.barcode,
        i.unit_cost::text AS "unitCost", i.unit_sell_price::text AS "unitSellPrice",
        i.tax_rate::text AS "taxRate", i.is_active AS "isActive", i.notes,
        CASE WHEN u.id IS NULL THEN NULL ELSE json_build_object(
          'id', u.id, 'name', u.name, 'abbreviation', u.abbreviation
        ) END AS unit
      FROM inventory.items i
      LEFT JOIN inventory.units u ON u.id = i.unit_id
      LEFT JOIN inventory.brands b ON b.id = i.brand_id
      WHERE i.id = $1`,
      [req.params.id],
    )
    if (!rows[0]) return res.status(404).json({ error: 'Item not found' })
    res.json(rows[0])
  } catch (err) {
    next(err)
  }
})

router.get('/units', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, name, abbreviation, is_active AS "isActive", created_at AS "createdAt"
      FROM inventory.units WHERE is_active = true ORDER BY name
    `)
    res.json(rows)
  } catch (err) {
    next(err)
  }
})

module.exports = router