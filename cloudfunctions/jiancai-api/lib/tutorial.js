const { getGameKey } = require('./config');

const COMPLETED_STEP = 99;

function saveKey() {
  return `${getGameKey()}_save`;
}

function parseSave(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const raw = payload[saveKey()];
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const save = JSON.parse(raw);
    return save && typeof save === 'object' ? save : null;
  } catch (_) {
    return null;
  }
}

function readTutorialCompletedFromSave(save) {
  if (!save) return false;
  if (typeof save.tutorialStep !== 'number' || !Number.isFinite(save.tutorialStep)) {
    return true;
  }
  return Math.floor(save.tutorialStep) >= COMPLETED_STEP;
}

function readTutorialCompletedFromPayload(payload) {
  return readTutorialCompletedFromSave(parseSave(payload));
}

function patchPayloadTutorialCompleted(payload) {
  const save = parseSave(payload);
  if (!save || readTutorialCompletedFromSave(save)) return payload || {};
  return {
    ...payload,
    [saveKey()]: JSON.stringify({ ...save, tutorialStep: COMPLETED_STEP }),
  };
}

function resolveTutorialCompleted(existing, payload, body) {
  const reset = !!(body && body.resetTutorial === true);
  const incoming = !!(body && body.tutorialCompleted === true)
    || readTutorialCompletedFromPayload(payload);
  if (reset) return incoming;
  return !!(existing && existing.tutorialCompleted)
    || incoming
    || readTutorialCompletedFromPayload(existing && existing.payload);
}

function tutorialFields(completed, existing, now = Date.now()) {
  if (!completed) {
    return {
      tutorialCompleted: false,
      tutorialCompletedAt: 0,
    };
  }
  return {
    tutorialCompleted: true,
    tutorialCompletedAt: Number(existing && existing.tutorialCompletedAt) > 0
      ? existing.tutorialCompletedAt
      : now,
  };
}

module.exports = {
  COMPLETED_STEP,
  saveKey,
  parseSave,
  readTutorialCompletedFromPayload,
  patchPayloadTutorialCompleted,
  resolveTutorialCompleted,
  tutorialFields,
};
