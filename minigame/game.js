var _runtime = require('./runtime.js');
var _nativeApi = _runtime.getNativePlatformApi();

var _diagMsgs = [];
var _diagStart = Date.now();
function _diag(msg) {
  var ts = Date.now() - _diagStart;
  var line = '[' + ts + 'ms] ' + msg;
  _diagMsgs.push(line);
  try { console.log(line); } catch (_) {}
}

function _showDiag() {
  try {
    if (_nativeApi && _nativeApi.showModal) {
      _nativeApi.showModal({
        title: '启动诊断',
        content: _diagMsgs.join('\n'),
        showCancel: false,
      });
    }
  } catch (_) {}
}

_diag('game.js 开始执行, host=' + _runtime.detectMinigamePlatform());

try {
  if (_nativeApi) {
    var _si = _nativeApi.getSystemInfoSync();
    _diag('platform:' + _si.platform + ' system:' + _si.system);
  }
} catch (e) {
  _diag('getSystemInfo失败:' + e);
}

try {
  if (typeof GameGlobal !== 'undefined') {
    GameGlobal.onError = function (msg) {
      _diag('onError:' + msg);
      _showDiag();
    };
    GameGlobal.onUnhandledRejection = function (ev) {
      _diag('unhandledRej:' + (ev && ev.reason || ev));
      _showDiag();
    };
  }
} catch (_) {}

_diag('加载 pixi-adapter...');
try {
  require('./pixi-adapter/index');
  _diag('pixi-adapter OK');
} catch (e) {
  _diag('pixi-adapter 失败!!:' + e);
  _showDiag();
}

if (typeof Intl === 'undefined') {
  _diag('Intl不存在,注入polyfill');
  var _g = typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof globalThis !== 'undefined' ? globalThis : {});
  _g.Intl = {};
}

var _started = false;
function _startGame(reason) {
  if (_started) return;
  _started = true;
  if (reason) _diag(reason);
  _diag('加载 game-bundle...');
  try {
    require('./game-bundle.js');
    _diag('game-bundle OK');
  } catch (e) {
    _diag('game-bundle 失败!!:' + e);
    _showDiag();
  }
  _diag('全部加载完成');
}

function _errText(err) {
  return String((err && (err.errMsg || err.message)) || err || '');
}

function _isDevtools() {
  try {
    return !!( _nativeApi && _nativeApi.getSystemInfoSync && _nativeApi.getSystemInfoSync().platform === 'devtools');
  } catch (_) {
    return false;
  }
}

function _requireImagesEntry() {
  try {
    require('./subpkg_images/game.js');
    return true;
  } catch (_) {
    return false;
  }
}

function _requireKitchenEntry() {
  try {
    require('./subpkg_kitchen/game.js');
    return true;
  } catch (_) {
    return false;
  }
}

function _loadImagesThenStart() {
  // 开发者工具里 loadSubpackage 常挂起或不回调，本地文件已在磁盘，直接开游戏。
  if (_isDevtools()) {
    if (_requireImagesEntry()) _diag('devtools 已 require 图片分包入口');
    if (_requireKitchenEntry()) _diag('devtools 已 require 厨房分包入口');
    _startGame('devtools 跳过 loadSubpackage');
    return;
  }

  if (!_nativeApi || typeof _nativeApi.loadSubpackage !== 'function') {
    if (_requireImagesEntry()) _diag('无 loadSubpackage,已 require 图片入口');
    if (_requireKitchenEntry()) _diag('无 loadSubpackage,已 require 厨房入口');
    _startGame('无分包 API,直接启动');
    return;
  }

  _diag('加载图片分包...');
  var timer = setTimeout(function () {
    _diag('分包 3s 未回调,继续启动');
    if (_requireImagesEntry()) _diag('超时后 require 图片入口 OK');
    if (_requireKitchenEntry()) _diag('超时后 require 厨房入口 OK');
    _startGame('分包超时兜底');
  }, 3000);

  function loadKitchen() {
    try {
      _nativeApi.loadSubpackage({
        name: 'kitchen',
        success: function () {
          clearTimeout(timer);
          _startGame('厨房分包 OK');
        },
        fail: function (err) {
          clearTimeout(timer);
          _diag('厨房分包失败:' + _errText(err));
          if (_requireKitchenEntry()) _diag('失败后 require 厨房入口 OK');
          _startGame('厨房分包失败仍启动');
        },
      });
    } catch (e) {
      clearTimeout(timer);
      _diag('厨房 loadSubpackage 异常:' + e);
      _startGame('厨房分包异常仍启动');
    }
  }

  try {
    _nativeApi.loadSubpackage({
      name: 'images',
      success: function () {
        _diag('图片分包 OK,加载厨房分包');
        loadKitchen();
      },
      fail: function (err) {
        _diag('图片分包失败:' + _errText(err));
        if (_requireImagesEntry()) _diag('失败后 require 图片入口 OK');
        loadKitchen();
      },
    });
  } catch (e) {
    clearTimeout(timer);
    _diag('loadSubpackage 异常:' + e);
    _startGame('分包异常仍启动');
  }
}

_loadImagesThenStart();

setTimeout(function () {
  if (typeof GameGlobal !== 'undefined' && !GameGlobal.__gameRendered) {
    _diag('12秒超时 - 游戏未渲染');
    _showDiag();
  }
}, 12000);
