/**
 * 捡菜市集统一后端（CloudBase 云函数 + HTTP 访问服务）
 *
 * 路由（全部 POST JSON）：
 *   /login        登录：wx/dy code2session / anon，签发 JWT
 *   /save/pull    拉取当前用户存档
 *   /save/push    上传当前用户存档（Upsert，updatedAt 防回写）
 *   /health       健康检查（无鉴权）
 *
 * 环境变量（CloudBase 控制台 → 云函数 → 环境变量）：
 *   GAME_KEY                         必填；游戏代号 jiancai
 *   JIANCAI_JWT_SECRET               必填；签发/校验 JWT
 *   JIANCAI_WX_APPID / JIANCAI_WX_SECRET   微信 code2session
 *   JIANCAI_TT_APPID / JIANCAI_TT_SECRET   抖音 code2session（可选）
 *   JIANCAI_SAVE_MAX_BYTES           可选，默认 262144（256KB）
 *   JIANCAI_TOKEN_TTL_SEC            可选，默认 604800（7d）
 */

const { handleLogin } = require('./lib/auth');
const { handlePull, handlePush } = require('./lib/save');
const { respond, parseEvent, preflight } = require('./lib/http');

const ROUTES = {
  'GET /health': async () => ({ ok: true, ts: Date.now() }),
  'POST /health': async () => ({ ok: true, ts: Date.now() }),
  'POST /login': handleLogin,
  'POST /save/pull': handlePull,
  'POST /save/push': handlePush,
};

exports.main = async (event, context) => {
  try {
    if (event && event.httpMethod === 'OPTIONS') {
      return preflight();
    }

    const req = parseEvent(event);
    const key = `${req.method} ${req.path}`;
    const handler = ROUTES[key];

    if (!handler) {
      return respond(404, { ok: false, code: 'NOT_FOUND', error: `no route: ${key}` });
    }

    const result = await handler(req, context);
    if (result && typeof result === 'object' && 'statusCode' in result) {
      return result;
    }
    return respond(200, { ok: true, data: result });
  } catch (e) {
    const code = e && e.code ? e.code : 'INTERNAL';
    const status = e && e.status ? e.status : 500;
    const message = (e && e.message) || String(e);
    console.error('[jiancai-api] error:', code, message, e && e.stack);
    const out = { ok: false, code, error: message };
    if (e && e.data !== undefined) out.data = e.data;
    return respond(status, out);
  }
};
