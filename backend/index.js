require('dotenv').config()
const express = require('express')
const cors = require('cors')
const inventoryRouter = require('./routes/inventory')
const quotationsRouter = require('./routes/quotations')

const app = express()
const port = Number(process.env.PORT) || 4500

app.use(cors())
app.use(express.json({ limit: '5mb' }))

app.get('/health', (req, res) => {
  res.json({ ok: true })
})

app.use('/api/inventory', inventoryRouter)
app.use('/api/inventory/quotations', quotationsRouter)

app.use((err, req, res, next) => {
  console.error(err)
  res.status(500).json({ error: err.message || 'Internal server error' })
})

app.listen(port, () => {
  console.log('quotation-backend on http://localhost:' + port)
})