const { httpError } = require('./http');
const { requireUser } = require('./auth');
const { getCollection } = require('./db');
const { getMaxBytes } = require('./config');
const {
  patchPayloadTutorialCompleted,
  readTutorialCompletedFromPayload,
  resolveTutorialCompleted,
  tutorialFields,
} = require('./tutorial');

function publicTutorialCompleted(doc) {
  if (!doc) return false;
  return !!doc.tutorialCompleted || readTutorialCompletedFromPayload(doc.payload);
}

function pullPayload(doc) {
  const tutorialCompleted = publicTutorialCompleted(doc);
  let payload = (doc && doc.payload) || {};
  if (tutorialCompleted) {
    payload = patchPayloadTutorialCompleted(payload);
  }
  return { payload, tutorialCompleted };
}

async function handlePull(req) {
  const { userId, platform } = requireUser(req);
  const col = getCollection(platform);

  const res = await col.where({ userId }).limit(1).get();
  const doc = (res && Array.isArray(res.data) && res.data[0]) || null;

  if (!doc) {
    return {
      userId,
      platform,
      exists: false,
      schemaVersion: 0,
      updatedAt: 0,
      payload: {},
      payloadKeys: [],
      tutorialCompleted: false,
    };
  }

  const { payload, tutorialCompleted } = pullPayload(doc);
  return {
    userId,
    platform,
    exists: true,
    schemaVersion: doc.schemaVersion || 0,
    updatedAt: doc.updatedAt || 0,
    payload,
    payloadKeys: Array.isArray(doc.payloadKeys)
      ? doc.payloadKeys
      : Object.keys(payload),
    clientFingerprint: doc.clientFingerprint || '',
    tutorialCompleted,
    tutorialCompletedAt: tutorialCompleted ? (doc.tutorialCompletedAt || 0) : 0,
  };
}

async function handlePush(req) {
  const { userId, platform } = requireUser(req);
  const body = req.body || {};

  const schemaVersion = Number(body.schemaVersion);
  const updatedAt = Number(body.updatedAt);
  const baseRemoteUpdatedAt = Number(body.baseRemoteUpdatedAt || 0);
  const payload = body.payload;
  const clientFingerprint = String(body.clientFingerprint || '').slice(0, 200);
  const force = body.force === true;

  if (!Number.isFinite(schemaVersion) || schemaVersion <= 0) {
    throw httpError(400, 'BAD_SCHEMA', 'schemaVersion 非法');
  }
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) {
    throw httpError(400, 'BAD_UPDATED_AT', 'updatedAt 非法');
  }
  if (!Number.isFinite(baseRemoteUpdatedAt) || baseRemoteUpdatedAt < 0) {
    throw httpError(400, 'BAD_BASE_REMOTE_UPDATED_AT', 'baseRemoteUpdatedAt 非法');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw httpError(400, 'BAD_PAYLOAD', 'payload 必须是 object');
  }

  const size = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  const maxBytes = getMaxBytes();
  if (size > maxBytes) {
    throw httpError(413, 'PAYLOAD_TOO_LARGE', `payload 超限: ${size}B > ${maxBytes}B`);
  }

  const payloadKeys = [];
  for (const k of Object.keys(payload)) {
    const v = payload[k];
    if (typeof v !== 'string') {
      throw httpError(400, 'BAD_PAYLOAD_VALUE', `payload[${k}] 必须是字符串`);
    }
    payloadKeys.push(k);
  }

  const col = getCollection(platform);
  const existingRes = await col.where({ userId }).limit(1).get();
  const existing = (existingRes && Array.isArray(existingRes.data) && existingRes.data[0]) || null;

  if (existing && !force) {
    const prevUpdatedAt = Number(existing.updatedAt) || 0;
    if (updatedAt < prevUpdatedAt || baseRemoteUpdatedAt < prevUpdatedAt) {
      const remoteView = pullPayload(existing);
      throw Object.assign(
        httpError(
          409,
          'STALE_UPDATE',
          `服务端已有更新版本 remote=${prevUpdatedAt} > local=${updatedAt}, base=${baseRemoteUpdatedAt}`,
        ),
        {
          data: {
            remote: {
              schemaVersion: existing.schemaVersion || 0,
              updatedAt: prevUpdatedAt,
              payload: remoteView.payload,
              payloadKeys: Array.isArray(existing.payloadKeys)
                ? existing.payloadKeys
                : Object.keys(remoteView.payload),
              tutorialCompleted: remoteView.tutorialCompleted,
            },
          },
        },
      );
    }
  }

  let mergedPayload = { ...(existing && existing.payload ? existing.payload : {}) };
  for (const k of Object.keys(payload)) {
    const v = payload[k];
    if (v === undefined || v === null) {
      delete mergedPayload[k];
    } else {
      mergedPayload[k] = v;
    }
  }

  const tutorialCompleted = resolveTutorialCompleted(existing, mergedPayload, body);
  if (tutorialCompleted && body.resetTutorial !== true) {
    mergedPayload = patchPayloadTutorialCompleted(mergedPayload);
  }

  const mergedPayloadKeys = Object.keys(mergedPayload);
  const mergedSize = Buffer.byteLength(JSON.stringify(mergedPayload), 'utf8');
  if (mergedSize > maxBytes) {
    throw httpError(413, 'PAYLOAD_TOO_LARGE', `payload 超限: ${mergedSize}B > ${maxBytes}B`);
  }

  const now = Date.now();
  const docData = {
    userId,
    platform,
    schemaVersion,
    updatedAt,
    baseRemoteUpdatedAt,
    clientFingerprint,
    payload: mergedPayload,
    payloadKeys: mergedPayloadKeys,
    lastWriteAt: now,
    ...tutorialFields(tutorialCompleted, existing, now),
  };

  if (existing && existing._id) {
    await col.doc(existing._id).update(docData);
    return {
      userId,
      updatedAt,
      savedAt: now,
      mode: 'update',
      sizeBytes: mergedSize,
      tutorialCompleted,
    };
  }

  const addRes = await col.add(docData);
  return {
    userId,
    updatedAt,
    savedAt: now,
    mode: 'insert',
    sizeBytes: size,
    tutorialCompleted,
    _id: addRes && (addRes.id || addRes._id),
  };
}

async function handleComplete(req) {
  const { userId, platform } = requireUser(req);
  const col = getCollection(platform);
  const existingRes = await col.where({ userId }).limit(1).get();
  const existing = (existingRes && Array.isArray(existingRes.data) && existingRes.data[0]) || null;
  const now = Date.now();
  const fields = tutorialFields(true, existing, now);

  if (existing && existing._id) {
    let payload = existing.payload || {};
    payload = patchPayloadTutorialCompleted(payload);
    await col.doc(existing._id).update({
      ...fields,
      payload,
      payloadKeys: Object.keys(payload),
      lastWriteAt: now,
    });
    return {
      userId,
      tutorialCompleted: true,
      tutorialCompletedAt: fields.tutorialCompletedAt,
      mode: 'update',
    };
  }

  const addRes = await col.add({
    userId,
    platform,
    schemaVersion: 1,
    updatedAt: 0,
    baseRemoteUpdatedAt: 0,
    clientFingerprint: '',
    payload: {},
    payloadKeys: [],
    lastWriteAt: now,
    ...fields,
  });
  return {
    userId,
    tutorialCompleted: true,
    tutorialCompletedAt: fields.tutorialCompletedAt,
    mode: 'insert',
    _id: addRes && (addRes.id || addRes._id),
  };
}

module.exports = {
  handlePull,
  handlePush,
  handleComplete,
};
