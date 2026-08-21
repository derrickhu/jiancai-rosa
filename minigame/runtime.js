/**
 * 小游戏宿主识别与原生 API 绑定（启动期单一真源，逻辑对齐 src/core/platformDetect.ts）
 *
 * - 抖音宿主：注入 tt → 只走 tt（同时存在的 wx 仅是宿主兼容层，能力不全）
 * - 微信宿主：注入 wx → 只走 wx
 *
 * 本文件在 game.js 最开头 require，须早于 pixi-adapter 与 game-bundle。
 */

function detectMinigamePlatform() {
  if (typeof tt !== 'undefined') return 'douyin';
  if (typeof wx !== 'undefined') return 'wechat';
  return 'unknown';
}

function getNativePlatformApi(platform) {
  var p = platform || detectMinigamePlatform();
  if (p === 'douyin') return typeof tt !== 'undefined' ? tt : null;
  if (p === 'wechat') return typeof wx !== 'undefined' ? wx : null;
  return null;
}

function canUsePrivacyApi(api, name) {
  if (!api) return false;
  if (typeof api.canIUse === 'function') {
    try { return !!api.canIUse(name); } catch (_) { /* 部分基础库 canIUse 会抛 */ }
  }
  return typeof api[name] === 'function';
}

/** 原生 API 未注册时（devtools / 后台未配隐私政策）的 JS 兜底，避免兼容层 stub 直接抛 unregistered */
function makePrivacyFallback(name) {
  return function (opts) {
    opts = opts || {};
    var res = {
      needAuthorization: false,
      privacyContractName: '',
      errMsg: name + ':ok (fallback)',
    };
    if (typeof opts.success === 'function') opts.success(res);
    if (typeof opts.complete === 'function') opts.complete(res);
  };
}

/**
 * 抖音隐私 API 启动兜底：
 * 1. 抖音开放平台配置「小游戏隐私政策」后，原生 API 才会注册（否则 INTERNAL_APPLY_NATIVE_ERROR）
 * 2. game.json usePrivacyCheck: true 启用合规链路
 * 3. 不主动 register onNeedPrivacyAuthorization，走抖音官方自动弹窗
 * 4. 把 wx 兼容层的隐私 stub 代理到 tt；tt 也不可用时降级为 noop（只消噪音，不改变原生行为）
 */
function initDouyinPrivacyBootstrap() {
  if (detectMinigamePlatform() !== 'douyin' || typeof tt === 'undefined') return;

  var privacyNames = [
    'getPrivacySetting',
    'requirePrivacyAuthorize',
    'openPrivacyContract',
    'onNeedPrivacyAuthorization',
  ];

  if (!canUsePrivacyApi(tt, 'getPrivacySetting')) {
    console.warn(
      '[Privacy] tt.getPrivacySetting 未注册。处理顺序：'
      + '①抖音开放平台→设置→基础设置→小游戏隐私政策 填写并发布；'
      + '②开发者工具升级到 4.2.3+ 并用真机扫码验证（工具内常报 unregistered）。',
    );
  }

  if (typeof wx === 'undefined') return;

  privacyNames.forEach(function (name) {
    if (name === 'onNeedPrivacyAuthorization') {
      if (typeof tt[name] === 'function') {
        wx[name] = function (cb) { return tt[name](cb); };
      }
      return;
    }
    if (canUsePrivacyApi(tt, name)) {
      wx[name] = function (opts) { return tt[name](opts); };
      return;
    }
    wx[name] = makePrivacyFallback(name);
  });
}

initDouyinPrivacyBootstrap();

module.exports = {
  detectMinigamePlatform: detectMinigamePlatform,
  getNativePlatformApi: getNativePlatformApi,
};
