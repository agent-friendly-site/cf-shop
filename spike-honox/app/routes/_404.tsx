/** @jsxImportSource react */
import type { NotFoundHandler } from 'hono'

const handler: NotFoundHandler = (c) => {
  c.status(404)
  return c.render(<p className="p-8">404 Not Found</p>, { title: '404' })
}

export default handler
