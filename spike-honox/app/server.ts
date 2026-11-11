import { showRoutes } from 'hono/dev'
import { createApp } from 'honox/server'
import { api } from './api'

// Hybrid mount proof: HonoX file routes + code-mounted API/MCP stubs.
const app = createApp({ trailingSlash: true })
app.route('/', api)

showRoutes(app)

export default app
