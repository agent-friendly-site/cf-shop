// Seller admin: web UI + JSON API for one shop, behind a per-shop API key.
// Routes are registered on the Hono app by registerAdminRoutes(app).
// Auth: Authorization: Bearer <key> (verified against the SHA-256 hash in
// D1 shop_admin_keys), or the httpOnly session cookie set by /login
// (24h, token hash in admin_sessions). Plaintext keys are never stored.
// Admin routes are intentionally NOT listed in llms.txt / agent.json:
// the admin is for the human seller, not for buyers' agents.
import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Order, ShopPolicies } from "./db";
import * as db from "./db";
import type { Env } from "./env";

type AppEnv = { Bindings: Env };
type AppContext = Context<AppEnv>;

function json(c: AppContext, obj: unknown, status: ContentfulStatusCode = 200) {
  return c.json(obj, status);
}

function parseCookies(c: AppContext): Record<string, string> {
  const out: Record<string, string> = {};
  const header = c.req.header("Cookie") || "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function requireAdmin(c: AppContext, shop: string) {
  const auth = c.req.header("Authorization") || "";
  if (auth.startsWith("Bearer ")) {
    if (await db.verifyAdminKey(c.env.DB, shop, auth.slice(7))) return true;
  }
  const token = parseCookies(c).af_admin;
  if (token && (await db.getSessionShop(c.env.DB, token)) === shop) return true;
  return false;
}

function unauthorized(c: AppContext) {
  return json(c, { error: "admin authentication required: log in with the shop admin key" }, 401);
}

async function body(c: AppContext): Promise<Record<string, unknown>> {
  try {
    return (await c.req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function orderSummary(o: Order) {
  return {
    id: o.id,
    shop: o.shop,
    items: o.items,
    subtotal_cny: o.subtotal_cny,
    shipping_cny: o.shipping_cny,
    total_cny: o.total_cny,
    status: o.status,
    buyer_name: o.buyer_name,
    buyer_contact: o.buyer_contact,
    shipping_address: o.shipping_address,
    carrier: o.carrier,
    tracking_number: o.tracking_number,
    shipped_at: o.shipped_at,
    completed_at: o.completed_at,
    cancelled_at: o.cancelled_at,
    cancel_reason: o.cancel_reason,
    verified_amount_cny: o.verified_amount_cny,
    verified_at: o.verified_at,
    verification_note: o.verification_note,
    created_at: o.created_at,
    updated_at: o.updated_at,
    proofs: o.proofs,
    timeline: o.timeline,
  };
}

function policyShape(pol: ShopPolicies | null) {
  if (!pol) return null;
  return { ...pol, order_statuses: JSON.parse(pol.order_statuses || "[]") as unknown[] };
}

export function registerAdminRoutes(app: Hono<AppEnv>) {
  // --- admin web UI (login form + dashboard). The page itself is public;
  // every API call behind it requires auth.
  app.get("/shops/:shop/admin/", async (c) => {
    const shop = await db.getShop(c.env.DB, c.req.param("shop"));
    if (!shop) return json(c, { error: `unknown shop: ${c.req.param("shop")}` }, 404);
    return c.html(
      ADMIN_HTML.replaceAll("__SHOP__", shop.slug).replaceAll(
        "__SHOP_NAME__",
        escapeHtml(shop.name_zh || shop.name),
      ),
    );
  });
  app.get("/shops/:shop/admin", (c) => c.redirect(`/shops/${c.req.param("shop")}/admin/`, 301));

  const api = "/shops/:shop/admin/api";

  app.post(`${api}/login`, async (c) => {
    const slug = c.req.param("shop");
    const shop = await db.getShop(c.env.DB, slug);
    if (!shop) return json(c, { error: `unknown shop: ${slug}` }, 404);
    const { key } = await body(c);
    if (typeof key !== "string" || !key || !(await db.verifyAdminKey(c.env.DB, slug, key))) {
      return json(c, { error: "wrong admin key" }, 401);
    }
    const { token, expires } = await db.createAdminSession(c.env.DB, slug);
    const res = json(c, { shop: slug, expires });
    res.headers.set(
      "Set-Cookie",
      `af_admin=${token}; Path=/shops/${slug}/admin/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`,
    );
    return res;
  });

  app.post(`${api}/logout`, async (c) => {
    const slug = c.req.param("shop");
    await db.deleteAdminSession(c.env.DB, parseCookies(c).af_admin);
    const res = json(c, { ok: true });
    res.headers.set(
      "Set-Cookie",
      `af_admin=; Path=/shops/${slug}/admin/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
    );
    return res;
  });

  app.get(`${api}/me`, async (c) => {
    const slug = c.req.param("shop");
    if (!(await requireAdmin(c, slug))) return unauthorized(c);
    return json(c, { shop: slug });
  });

  app.get(`${api}/orders`, async (c) => {
    const slug = c.req.param("shop");
    if (!(await requireAdmin(c, slug))) return unauthorized(c);
    const status = c.req.query("status") || undefined;
    const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "50", 10) || 50, 1), 200);
    const orders = await db.listOrders(c.env.DB, slug, { status, limit });
    const counts = await db.orderCounts(c.env.DB, slug);
    return json(c, { shop: slug, counts, orders: orders.map(orderSummary) });
  });

  app.get(`${api}/orders/:id`, async (c) => {
    const slug = c.req.param("shop");
    if (!(await requireAdmin(c, slug))) return unauthorized(c);
    const order = await db.getOrder(c.env.DB, c.req.param("id"));
    if (!order || order.shop !== slug) return json(c, { error: "unknown order" }, 404);
    return json(c, { order: orderSummary(order) });
  });

  // Proof image (v1.6.0): serve an image proof from private R2 storage.
  // Admin-only: the buyer's upload link is NOT enough to view it, and
  // the image is never served from a public URL.
  app.get(`${api}/orders/:id/proofs/:proofId/image`, async (c) => {
    const slug = c.req.param("shop");
    if (!(await requireAdmin(c, slug))) return unauthorized(c);
    const order = await db.getOrder(c.env.DB, c.req.param("id"));
    if (!order || order.shop !== slug) return json(c, { error: "unknown order" }, 404);
    const proof = (order.proofs || []).find((p) => p.id === c.req.param("proofId"));
    if (proof?.proof_type !== "image" || !proof.r2_key) {
      return json(c, { error: "no image proof" }, 404);
    }
    const obj = await c.env.PROOFS.get(proof.r2_key);
    if (!obj) return json(c, { error: "image not found" }, 404);
    return new Response(obj.body, {
      headers: {
        "Content-Type": obj.httpMetadata?.contentType || proof.mime_type || "image/jpeg",
        "Cache-Control": "private, max-age=3600",
      },
    });
  });

  app.post(`${api}/orders/:id/confirm-payment`, async (c) => {
    const slug = c.req.param("shop");
    if (!(await requireAdmin(c, slug))) return unauthorized(c);
    const order = await db.getOrder(c.env.DB, c.req.param("id"));
    if (!order || order.shop !== slug) return json(c, { error: "unknown order" }, 404);
    const { verified_amount_cny, note } = await body(c);
    try {
      const done = await db.confirmPayment(c.env.DB, {
        orderId: order.id,
        verifiedAmountCny: Number(verified_amount_cny),
        note: typeof note === "string" ? note : undefined,
      });
      return json(c, { order: done ? orderSummary(done) : null });
    } catch (e) {
      return json(c, { error: errMessage(e) }, 400);
    }
  });

  app.post(`${api}/orders/:id/mark-shipped`, async (c) => {
    const slug = c.req.param("shop");
    if (!(await requireAdmin(c, slug))) return unauthorized(c);
    const order = await db.getOrder(c.env.DB, c.req.param("id"));
    if (!order || order.shop !== slug) return json(c, { error: "unknown order" }, 404);
    const { carrier, tracking_number } = await body(c);
    try {
      const done = await db.markShipped(c.env.DB, {
        orderId: order.id,
        carrier: typeof carrier === "string" ? carrier : undefined,
        trackingNumber: typeof tracking_number === "string" ? tracking_number : undefined,
      });
      return json(c, { order: done ? orderSummary(done) : null });
    } catch (e) {
      return json(c, { error: errMessage(e) }, 400);
    }
  });

  app.post(`${api}/orders/:id/cancel`, async (c) => {
    const slug = c.req.param("shop");
    if (!(await requireAdmin(c, slug))) return unauthorized(c);
    const order = await db.getOrder(c.env.DB, c.req.param("id"));
    if (!order || order.shop !== slug) return json(c, { error: "unknown order" }, 404);
    const { reason } = await body(c);
    try {
      const done = await db.cancelOrder(c.env.DB, {
        orderId: order.id,
        reason: typeof reason === "string" ? reason : undefined,
        actor: "seller",
      });
      return json(c, { order: done ? orderSummary(done) : null });
    } catch (e) {
      return json(c, { error: errMessage(e) }, 400);
    }
  });

  app.get(`${api}/products`, async (c) => {
    const slug = c.req.param("shop");
    if (!(await requireAdmin(c, slug))) return unauthorized(c);
    const products = await db.listProducts(c.env.DB, slug);
    return json(c, { shop: slug, products });
  });

  app.put(`${api}/products/:id`, async (c) => {
    const slug = c.req.param("shop");
    if (!(await requireAdmin(c, slug))) return unauthorized(c);
    const { price_cny, stock } = await body(c);
    try {
      const p = await db.updateProduct(c.env.DB, slug, c.req.param("id"), {
        price: typeof price_cny === "number" ? price_cny : Number(price_cny),
        stock: typeof stock === "number" ? stock : Number(stock),
      });
      return json(c, { product: p });
    } catch (e) {
      return json(c, { error: errMessage(e) }, 400);
    }
  });

  app.get(`${api}/policies`, async (c) => {
    const slug = c.req.param("shop");
    if (!(await requireAdmin(c, slug))) return unauthorized(c);
    const pol = await db.getPolicies(c.env.DB, slug);
    const payment = await db.getPayment(c.env.DB, slug);
    return json(c, { shop: slug, policies: policyShape(pol), payment: payment?.payment || null });
  });

  app.put(`${api}/policies`, async (c) => {
    const slug = c.req.param("shop");
    if (!(await requireAdmin(c, slug))) return unauthorized(c);
    const patch = await body(c);
    try {
      const pol = await db.updatePolicies(c.env.DB, slug, patch);
      let payment = await db.getPayment(c.env.DB, slug);
      if (patch.payment_methods) {
        payment = await db.updatePaymentMethods(
          c.env.DB,
          slug,
          patch.payment_methods as { id: string; instructions: string }[],
        );
      }
      return json(c, { shop: slug, policies: policyShape(pol), payment: payment?.payment || null });
    } catch (e) {
      return json(c, { error: errMessage(e) }, 400);
    }
  });
}

function escapeHtml(s: string) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Platform-owned admin page (not merchant markup). Plain HTML + fetch,
// no framework. The key is kept in memory only for Bearer fallback;
// after login the httpOnly session cookie is what keeps the seller in.
const ADMIN_HTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:,">
<title>卖家后台 — __SHOP_NAME__</title>
<style>
body{font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;max-width:960px;margin:0 auto;padding:24px;color:#222}
h1{font-size:22px}h2{font-size:18px;margin-top:32px}
.card{border:1px solid #ddd;border-radius:8px;padding:16px;margin:12px 0}
button{padding:6px 14px;margin:2px;cursor:pointer}
input,select{padding:6px;margin:2px}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:6px 8px;text-align:left;font-size:14px}
.muted{color:#666;font-size:13px}.bad{color:#b00;font-weight:bold}.ok{color:#070}
.pill{display:inline-block;padding:2px 8px;border-radius:12px;background:#eee;font-size:12px;margin-right:4px}
#login{display:block}#app{display:none}
pre{white-space:pre-wrap;word-break:break-word;background:#f7f7f7;padding:8px;border-radius:6px;font-size:13px}
</style></head><body>
<h1>卖家后台 — __SHOP_NAME__</h1>
<p class="muted">店铺：__SHOP__ · 后台只对卖家开放，买家看不到这个页面。</p>

<div id="login" class="card">
  <h2>登录</h2>
  <p class="muted">输入这家店的管理 Key（由平台发给店主，只显示一次，请妥善保存）。</p>
  <input id="key" type="password" placeholder="管理 Key" style="width:320px">
  <button onclick="doLogin()">登录</button>
  <p id="loginErr" class="bad"></p>
</div>

<div id="app">
  <p><button onclick="loadOrders()">刷新订单</button> <button onclick="loadProducts()">商品管理</button> <button onclick="loadPolicies()">政策管理</button> <button onclick="doLogout()">退出登录</button></p>
  <div id="counts"></div>
  <div id="filters"></div>
  <div id="orders"></div>
  <div id="detail"></div>
  <div id="products"></div>
  <div id="policies"></div>
</div>

<script>
var SHOP = "__SHOP__";
var API = "/shops/" + SHOP + "/admin/api";
var KEY = "";
var STATUS_LABEL = {pending_payment:"待付款",payment_submitted:"待核验",paid:"已付款待发货",shipped:"已发货",completed:"已完成",cancelled:"已取消"};

function esc(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function headers(){ var h = {"Content-Type":"application/json"}; if (KEY) h["Authorization"] = "Bearer " + KEY; return h; }
async function api(path, opts){
  opts = opts || {};
  opts.headers = headers();
  var r = await fetch(API + path, opts);
  var j = await r.json().catch(function(){ return {}; });
  if (!r.ok) throw new Error(j.error || ("HTTP " + r.status));
  return j;
}
function showApp(){ document.getElementById("login").style.display="none"; document.getElementById("app").style.display="block"; }
async function doLogin(){
  var k = document.getElementById("key").value.trim();
  if (!k) return;
  try {
    KEY = k;
    var r = await fetch(API + "/login", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({key:k})});
    if (!r.ok) throw new Error("Key 不对，请检查后重试");
    document.getElementById("key").value = "";
    showApp(); loadOrders();
  } catch(e){ document.getElementById("loginErr").textContent = e.message; }
}
async function doLogout(){ try { await api("/logout", {method:"POST"}); } catch(e){} KEY=""; location.reload(); }

var CUR_STATUS = "";
async function loadOrders(){
  try {
    var q = CUR_STATUS ? ("?status=" + CUR_STATUS) : "";
    var d = await api("/orders" + q);
    var c = d.counts;
    document.getElementById("counts").innerHTML = Object.keys(STATUS_LABEL).map(function(s){
      return '<span class="pill">' + STATUS_LABEL[s] + "：" + (c[s]||0) + "</span>";
    }).join("") + '<span class="pill">共 ' + c.total + " 单</span>";
    document.getElementById("filters").innerHTML = '<button data-filter="">全部</button>' +
      Object.keys(STATUS_LABEL).map(function(s){ return '<button data-filter="' + s + '">' + STATUS_LABEL[s] + "</button>"; }).join("");
    var rows = d.orders.map(function(o){
      var items = o.items.map(function(i){ return esc(i.name) + " ×" + i.quantity + "（" + i.line_total + " 元）"; }).join("；");
      return "<tr><td>" + esc(o.id) + "</td><td>" + esc(o.buyer_name||"—") + "<br><span class='muted'>" + esc(o.buyer_contact||"") + "</span></td><td>" + items + "</td><td>" + o.total_cny + " 元</td><td>" + STATUS_LABEL[o.status] + "</td><td>" + esc(o.created_at.slice(0,19).replace("T"," ")) + "</td><td><button data-order='" + o.id + "'>详情</button></td></tr>";
    }).join("");
    document.getElementById("orders").innerHTML = "<h2>订单</h2><table><tr><th>订单号</th><th>买家</th><th>商品</th><th>总价</th><th>状态</th><th>下单时间</th><th></th></tr>" + rows + "</table>";
  } catch(e){ document.getElementById("orders").innerHTML = "<p class='bad'>" + esc(e.message) + "</p>"; }
}
function setFilter(s){ CUR_STATUS = s; loadOrders(); }

async function showOrder(id){
  var d = await api("/orders/" + id);
  var o = d.order;
  var proofs = (o.proofs||[]).map(function(p){
    var when = esc((p.created_at||"").slice(0,19).replace("T"," "));
    if (p.proof_type === "image") {
      var img = "<br><img src='/shops/" + SHOP + "/admin/api/orders/" + o.id + "/proofs/" + p.id + "/image' style='max-width:100%;border:1px solid #ccc;border-radius:6px;margin-top:6px'>";
      var amt = (p.amount_cny !== null && p.amount_cny !== undefined) ? (" · " + p.amount_cny + " 元") : " · 金额见图";
      var txn = p.transaction_id ? (" · 单号 " + esc(p.transaction_id)) : "";
      return "<li>图片凭据 · " + esc(p.payment_method) + txn + amt + " · " + esc(p.file_name||"") + " · " + when + img + "</li>";
    }
    return "<li>" + esc(p.payment_method) + " · 单号 " + esc(p.transaction_id) + " · " + p.amount_cny + " 元 · " + when + "</li>";
  }).join("") || "<li>暂无</li>";
  var tl = (o.timeline||[]).map(function(t){ return "<li>" + esc(t.created_at.slice(0,19).replace("T"," ")) + " · " + esc(t.event) + (t.from_status?("（"+esc(t.from_status)+" → "+esc(t.to_status)+"）"):"") + " · " + esc(t.actor) + (t.note?(" · "+esc(t.note)):"") + "</li>"; }).join("") || "<li>暂无事件</li>";
  var mismatch = "";
  var amountProofs = (o.proofs||[]).filter(function(p){ return p.amount_cny !== null && p.amount_cny !== undefined; });
  var proofTotal = amountProofs.reduce(function(a,p){ return a + p.amount_cny; }, 0);
  if (o.status === "payment_submitted" && amountProofs.length > 0 && proofTotal !== o.total_cny) mismatch = "<p class='bad'>注意：凭据金额 " + proofTotal + " 元与订单总额 " + o.total_cny + " 元不一致，确认前请先联系买家核对。</p>";
  else if (o.status === "payment_submitted" && amountProofs.length === 0) mismatch = "<p>图片凭据没有填写金额：请看图核对金额，在上面输入实际到账金额再确认收款。</p>";
  var html = "<div class='card'><h2>订单 " + esc(o.id) + " · " + STATUS_LABEL[o.status] + "</h2>"
    + "<p>总价 " + o.total_cny + " 元（商品 " + o.subtotal_cny + " + 运费 " + o.shipping_cny + "）</p>"
    + "<p>买家：" + esc(o.buyer_name||"—") + " · " + esc(o.buyer_contact||"—") + "<br>收货地址：" + esc(o.shipping_address||"—") + "</p>"
    + "<p>商品：" + o.items.map(function(i){ return esc(i.name)+" ×"+i.quantity; }).join("；") + "</p>"
    + "<p>付款凭据：</p><ul>" + proofs + "</ul>" + mismatch
    + "<p>物流：" + esc(o.carrier||"—") + " " + esc(o.tracking_number||"") + "</p>"
    + "<p>时间线：</p><ul>" + tl + "</ul>";
  if (o.status === "payment_submitted") {
    html += "<p>确认收款金额：<input id='vamt' type='number' value='" + o.total_cny + "'> 元 <button data-action='confirm-pay' data-id='" + o.id + "'>确认收款</button></p>";
  }
  if (o.status === "paid") {
    html += "<p>快递公司：<input id='carrier' placeholder='如 顺丰'> 单号：<input id='tnum' placeholder='快递单号（可空）'> <button data-action='ship' data-id='" + o.id + "'>标记发货</button></p>";
  }
  if (o.status === "pending_payment" || o.status === "payment_submitted") {
    html += "<p><button data-action='cancel-order' data-id='" + o.id + "'>取消订单</button></p>";
  }
  html += "<p id='actErr' class='bad'></p></div>";
  document.getElementById("detail").innerHTML = html;
  document.getElementById("detail").scrollIntoView();
}
async function confirmPay(id){
  var amt = Number(document.getElementById("vamt").value);
  try { await api("/orders/" + id + "/confirm-payment", {method:"POST", body: JSON.stringify({verified_amount_cny: amt})}); showOrder(id); loadOrders(); }
  catch(e){ document.getElementById("actErr").textContent = e.message; }
}
async function ship(id){
  var carrier = document.getElementById("carrier").value.trim();
  var tn = document.getElementById("tnum").value.trim();
  try { await api("/orders/" + id + "/mark-shipped", {method:"POST", body: JSON.stringify({carrier: carrier, tracking_number: tn})}); showOrder(id); loadOrders(); }
  catch(e){ document.getElementById("actErr").textContent = e.message; }
}
async function cancelOrder(id){
  if (!confirm("确定取消这个订单吗？")) return;
  try { await api("/orders/" + id + "/cancel", {method:"POST", body: JSON.stringify({reason:"卖家取消"})}); showOrder(id); loadOrders(); }
  catch(e){ document.getElementById("actErr").textContent = e.message; }
}
async function loadProducts(){
  var d = await api("/products");
  var rows = d.products.map(function(p){
    return "<tr><td>" + esc(p.name_zh||p.name) + "<br><span class='muted'>" + esc(p.id) + "</span></td><td><input id='price-" + p.id + "' type='number' value='" + p.price + "' style='width:80px'> 元</td><td><input id='stock-" + p.id + "' type='number' value='" + p.stock + "' style='width:70px'> 件</td><td><button data-action='save-product' data-id='" + p.id + "'>保存</button></td></tr>";
  }).join("");
  document.getElementById("products").innerHTML = "<h2>商品管理</h2><p class='muted'>改价格或库存后，店铺的商品列表会立即更新。库存改成 0 即为无货。</p><table><tr><th>商品</th><th>价格</th><th>库存</th><th></th></tr>" + rows + "</table>";
}
async function saveProduct(id){
  var price = Number(document.getElementById("price-"+id).value);
  var stock = Number(document.getElementById("stock-"+id).value);
  try { await api("/products/" + id, {method:"PUT", body: JSON.stringify({price_cny: price, stock: stock})}); alert("已保存"); }
  catch(e){ alert(e.message); }
}
async function loadPolicies(){
  var d = await api("/policies");
  var p = d.policies, pay = d.payment;
  var methods = (pay.methods||[]).map(function(m){ return "<p>" + esc(m.label) + "：<input id='pm-" + m.id + "' value='" + esc(m.instructions) + "' style='width:420px'></p>"; }).join("");
  document.getElementById("policies").innerHTML = "<h2>政策管理</h2>"
    + "<p>运费：<input id='ship' type='number' value='" + p.shipping_flat_cny + "'> 元 · 满 <input id='freeover' type='number' value='" + p.free_over_cny + "'> 元免邮 · 发货时效：<input id='lead' value='" + esc(p.lead_time) + "'></p>"
    + "<p>退货天数：<input id='rwin' type='number' value='" + p.returns_window_days + "'> 天 · 退货条件：<input id='rcond' value='" + esc(p.returns_condition||"") + "'> · 退货运费：<input id='rship' value='" + esc(p.return_shipping||"") + "'></p>"
    + "<h3>收款方式说明</h3>" + methods
    + "<p><button data-action='save-policies'>保存政策</button></p><p id='polErr' class='bad'></p>";
}
async function savePolicies(){
  var patch = {shipping_flat_cny: Number(document.getElementById("ship").value), free_over_cny: Number(document.getElementById("freeover").value), lead_time: document.getElementById("lead").value, returns_window_days: Number(document.getElementById("rwin").value), returns_condition: document.getElementById("rcond").value, return_shipping: document.getElementById("rship").value};
  patch.payment_methods = Array.prototype.map.call(document.querySelectorAll("[id^='pm-']"), function(el){ return {id: el.id.slice(3), instructions: el.value}; });
  try { await api("/policies", {method:"PUT", body: JSON.stringify(patch)}); alert("已保存"); }
  catch(e){ document.getElementById("polErr").textContent = e.message; }
}
// 动态生成的按钮不用 inline onclick（模板字符串里转义会丢，整段 script 会解析失败，
// 之前 doLogin is not defined 就是这么来的），改用 data- 属性 + 事件委托。
document.addEventListener("click", function(e){
  var b = e.target.closest("button[data-action],button[data-filter],button[data-order]");
  if (!b) return;
  if (b.hasAttribute("data-filter")) { setFilter(b.getAttribute("data-filter")); return; }
  if (b.hasAttribute("data-order")) { showOrder(b.getAttribute("data-order")); return; }
  var act = b.getAttribute("data-action");
  var id = b.getAttribute("data-id");
  if (act === "confirm-pay") confirmPay(id);
  else if (act === "ship") ship(id);
  else if (act === "cancel-order") cancelOrder(id);
  else if (act === "save-product") saveProduct(id);
  else if (act === "save-policies") savePolicies();
});
api("/me").then(function(){ showApp(); loadOrders(); }).catch(function(){});
</script></body></html>`;
