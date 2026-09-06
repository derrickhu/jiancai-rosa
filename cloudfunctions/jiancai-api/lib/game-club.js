const crypto = require('crypto');
const { httpError } = require('./http');
const { getDb } = require('./db');
const { getCollectionName } = require('./config');

function getSessionCollection() {
  return getDb().collection(getCollectionName('wxSessions'));
}

async function upsertWxSession(userId, sessionKey) {
  if (!sessionKey) {
    return;
  }
  const col = getSessionCollection();
  const now = Date.now();
  const existingRes = await col.where({ userId }).limit(1).get();
  const existing = (existingRes && Array.isArray(existingRes.data) && existingRes.data[0]) || null;
  if (existing && existing._id) {
    await col.doc(existing._id).update({
      sessionKey,
      updatedAt: now,
    });
    return;
  }
  await col.add({
    userId,
    sessionKey,
    updatedAt: now,
  });
}

async function readWxSessionKey(userId) {
  const col = getSessionCollection();
  const res = await col.where({ userId }).limit(1).get();
  const doc = (res && Array.isArray(res.data) && res.data[0]) || null;
  return doc && typeof doc.sessionKey === 'string' ? doc.sessionKey : '';
}

function decryptGameClubPayload(sessionKey, encryptedData, iv) {
  if (!sessionKey || !encryptedData || !iv) {
    throw httpError(400, 'BAD_GAME_CLUB_PAYLOAD', 'encryptedData / iv / sessionKey 缺失');
  }
  try {
    const decipher = crypto.createDecipheriv(
      'aes-128-cbc',
      Buffer.from(sessionKey, 'base64'),
      Buffer.from(iv, 'base64'),
    );
    decipher.setAutoPadding(true);
    const decoded = Buffer.concat([
      decipher.update(Buffer.from(encryptedData, 'base64')),
      decipher.final(),
    ]).toString('utf8');
    return JSON.parse(decoded);
  } catch (error) {
    throw httpError(400, 'DECRYPT_FAIL', error && error.message ? error.message : '游戏圈数据解密失败');
  }
}

async function handleDecrypt(req) {
  const { requireUser } = require('./auth');
  const { userId } = requireUser(req);
  const body = req.body || {};
  const encryptedData = String(body.encryptedData || '').trim();
  const iv = String(body.iv || '').trim();
  const sessionKey = await readWxSessionKey(userId);
  if (!sessionKey) {
    throw httpError(400, 'NO_WX_SESSION', '微信 session 未就绪，请重新进入游戏');
  }
  return decryptGameClubPayload(sessionKey, encryptedData, iv);
}

module.exports = {
  upsertWxSession,
  handleDecrypt,
};
