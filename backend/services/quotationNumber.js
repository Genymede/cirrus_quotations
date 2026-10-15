function bangkokDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

async function generateQuotationNumber(client, issueDate) {
  const day = bangkokDate()
  const [y, m, d] = day.split('-')
  const prefix = `QTS${d}${m}${y}`

  await client.query(`SELECT pg_advisory_xact_lock(hashtext('quotation_number'))`)

  const { rows } = await client.query(
    `SELECT number FROM sales.quotations
     WHERE number LIKE $1
     ORDER BY number DESC LIMIT 1`,
    [`${prefix}%`],
  )

  let seq = 1
  if (rows[0]) {
    const n = parseInt(rows[0].number.slice(prefix.length), 10)
    if (!Number.isNaN(n)) seq = n + 1
  }

  return `${prefix}${String(seq).padStart(3, '0')}`
}

module.exports = { generateQuotationNumber }