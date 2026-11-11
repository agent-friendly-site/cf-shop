/** @jsxImportSource react */
import { createRoute } from 'honox/factory'
import AdminConsole from '../../../../islands/admin-console'

export default createRoute((c) => {
  const shop = c.req.param('shop')
  return c.render(<AdminConsole shop={shop} />, {
    title: `${shop} admin · HonoX spike`,
  })
})
