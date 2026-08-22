const tcb = require('@cloudbase/node-sdk');
const { getCollectionName } = require('./config');

let _app = null;

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
};
