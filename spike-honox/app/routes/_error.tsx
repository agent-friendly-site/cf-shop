/** @jsxImportSource react */
import type { ErrorHandler } from 'hono'

const handler: ErrorHandler = (e, c) => {
  if ('getResponse' in e) {
    return e.getResponse()
  }
  console.error(e.message)
  c.status(500)
  return c.render(<p className="p-8">Internal Server Error</p>, { title: 'Error' })
}

export default handler
