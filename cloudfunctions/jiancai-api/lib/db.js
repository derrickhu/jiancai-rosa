const tcb = require('@cloudbase/node-sdk');
const { getCollectionName } = require('./config');

let _app = null;
const _ensured = new Set();

function getApp() {
  if (_app) return _app;
  _app = tcb.init({
    env: process.env.TCB_ENV || tcb.SYMBOL_CURRENT_ENV,
  });
  return _app;
}

function getDb() {
  return getApp().database();
}

function errorText(err) {
  if (!err) return '';
  const parts = [err.code, err.errorCode, err.errCode, err.message, err.error];
  return parts.filter(Boolean).join(' ');
}

function isCollectionMissing(err) {
  const text = errorText(err);
  return /DATABASE_COLLECTION_NOT_EXIST|COLLECTION_NOT_EXIST|ResourceNotFound|Db or Table not exist/i.test(text);
}

function isCollectionExists(err) {
  const text = errorText(err);
  return /DATABASE_COLLECTION_EXIST|COLLECTION_EXIST|already exists|已存在/i.test(text);
}

async function ensureCollection(name) {
  if (!name || _ensured.has(name)) return;
  try {
    await getDb().createCollection(name);
  } catch (err) {
    if (!isCollectionExists(err)) {
      console.warn('[jiancai-api] createCollection failed', name, errorText(err));
      throw err;
    }
  }
  _ensured.add(name);
}

async function withCollection(name, work) {
  try {
    return await work();
  } catch (err) {
    if (!isCollectionMissing(err)) throw err;
    await ensureCollection(name);
    return work();
  }
}

/** 存档主表：按平台隔离（wx → jiancai_playerData，dy → jiancai_tt_playerData） */
function getCollection(platform) {
  return getDb().collection(getCollectionName('playerData', platform));
}

function collection(suffix, platform) {
  return getDb().collection(getCollectionName(suffix, platform));
}

module.exports = {
  getApp,
  getDb,
  getCollection,
  collection,
  ensureCollection,
  isCollectionMissing,
  withCollection,
};
