import { Hono } from 'hono'

const app = new Hono()

app.get('/v1/health', (c) => {
  return c.json({ status: 'ok', service: 'fathom-api' })
})

export default app
