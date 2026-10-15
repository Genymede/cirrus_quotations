const { pool } = require('../db')

let cached = null

async function resolveDefaultUserId() {
  if (process.env.DEFAULT_USER_ID) return process.env.DEFAULT_USER_ID
  if (cached) return cached

  const { rows } = await pool.query(
    `SELECT id FROM core.users ORDER BY created_at NULLS LAST, id LIMIT 1`,
  )
  if (!rows[0]) {
    throw new Error('Set DEFAULT_USER_ID in .env or insert a row into core.users')
  }
  cached = rows[0].id
  return cached
}

module.exports = { resolveDefaultUserId }