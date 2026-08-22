import { scopeStorageKey, getScopedGameKey } from '@/config/gameKeyScope';
import {
  detectMinigamePlatform,
  getNativePlatformApi,
  toBackendPlatformCode,
  type BackendPlatformCode,
  type PlatformName,
} from './platformDetect';

export type { PlatformName, BackendPlatformCode };
export { detectMinigamePlatform };

class PlatformServiceClass {
  readonly name: PlatformName;
  private readonly _api: any;

  constructor() {
    this.name = detectMinigamePlatform();
    this._api = getNativePlatformApi(this.name);
    const apiLabel = this.name === 'douyin' ? 'tt' : this.name === 'wechat' ? 'wx' : 'none';
    console.log(`[Platform] 当前平台: ${this.name}, api=${apiLabel}, gameKey=${getScopedGameKey(this.name)}`);
  }

  get backendPlatformCode(): BackendPlatformCode {
    return toBackendPlatformCode(this.name);
  }

  get scopedGameKey(): string {
    return getScopedGameKey(this.name);
  }

  get isMinigame(): boolean {
    return this.name === 'wechat' || this.name === 'douyin';
  }

  get isWechat(): boolean {
    return this.name === 'wechat';
  }

  get isDouyin(): boolean {
    return this.name === 'douyin';
  }

  /**
   * 是否有可用的后端 HTTP 通道
   * - 微信 / 抖音小游戏：有原生 request API
   * - 浏览器：有全局 fetch
   */
  get canUseBackend(): boolean {
    if (this._api && typeof this._api.request === 'function') return true;
    return typeof (globalThis as any).fetch === 'function';
  }

  get api(): any {
    return this._api;
  }

  createImage(): any {
    if (this._api?.createImage) return this._api.createImage();
    if (typeof Image !== 'undefined') return new (Image as any)();
    return { src: '', onload: null, onerror: null };
  }

  storageKey(key: string): string {
    return scopeStorageKey(key, this.name);
  }

  getStorageSync(key: string): string | null {
    const physicalKey = this.storageKey(key);
    try {
      if (this._api?.getStorageSync) {
        return this._api.getStorageSync(physicalKey) || null;
      }
      if (typeof localStorage !== 'undefined') return localStorage.getItem(physicalKey);
    } catch (_) {}
    return null;
  }

  setStorageSync(key: string, value: string): void {
    const physicalKey = this.storageKey(key);
    try {
      if (this._api?.setStorageSync) {
        this._api.setStorageSync(physicalKey, value);
        return;
      }
      if (typeof localStorage !== 'undefined') localStorage.setItem(physicalKey, value);
    } catch (_) {}
  }

  removeStorageSync(key: string): void {
    const physicalKey = this.storageKey(key);
    try {
      if (this._api?.removeStorageSync) {
        this._api.removeStorageSync(physicalKey);
        return;
      }
      if (typeof localStorage !== 'undefined') localStorage.removeItem(physicalKey);
    } catch (_) {}
  }

  request(opts: {
    url: string;
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    data?: unknown;
    headers?: Record<string, string>;
    timeoutMs?: number;
  }): Promise<{ statusCode: number; data: any }> {
    const method = (opts.method || 'POST').toUpperCase();
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...(opts.headers || {}),
    };
    const timeoutMs = opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : 10000;

    if (this._isDevtools() && typeof (globalThis as any).fetch === 'function') {
      return this._requestViaFetch(opts.url, method, opts.data, headers, timeoutMs);
    }
    if (this._api && typeof this._api.request === 'function') {
      return this._requestViaMiniApi(opts.url, method, opts.data, headers, timeoutMs);
    }
    if (typeof (globalThis as any).fetch === 'function') {
      return this._requestViaFetch(opts.url, method, opts.data, headers, timeoutMs);
    }
    return Promise.reject(new Error('no http transport available'));
  }

  private _requestViaMiniApi(
    url: string,
    method: string,
    data: unknown,
    headers: Record<string, string>,
    timeoutMs: number,
  ): Promise<{ statusCode: number; data: any }> {
    return new Promise((resolve, reject) => {
      let done = false;
      const requestData = data === undefined || typeof data === 'string'
        ? data
        : JSON.stringify(data);
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        reject(new Error(`request timeout after ${timeoutMs}ms: ${url}`));
      }, timeoutMs);

      try {
        this._api.request({
          url,
          method,
          data: requestData,
          header: headers,
          timeout: timeoutMs,
          success: (res: any) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            resolve({
              statusCode: res?.statusCode ?? 0,
              data: res?.data,
            });
          },
          fail: (err: any) => {
            if (done) return;
            clearTimeout(timer);
            const msg = err?.errMsg || err?.message || String(err);
            const fetchFn = (globalThis as any).fetch as typeof fetch | undefined;
            if (typeof fetchFn === 'function' && /request:fail/i.test(msg)) {
              void this._requestViaFetch(url, method, data, headers, timeoutMs)
                .then((result) => {
                  if (done) return;
                  done = true;
                  resolve(result);
                })
                .catch((e2) => {
                  if (done) return;
                  done = true;
                  reject(new Error(`request failed: ${msg}; fetchFallback=${e2 instanceof Error ? e2.message : String(e2)}`));
                });
              return;
            }
            done = true;
            reject(new Error(`request failed: ${msg}; url=${url}`));
          },
        });
      } catch (e) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  private _requestViaFetch(
    url: string,
    method: string,
    data: unknown,
    headers: Record<string, string>,
    timeoutMs: number,
  ): Promise<{ statusCode: number; data: any }> {
    const fetchFn = (globalThis as any).fetch as typeof fetch;
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    const init: any = {
      method,
      headers,
      signal: ctrl ? ctrl.signal : undefined,
    };
    if (data !== undefined && method !== 'GET') {
      init.body = typeof data === 'string' ? data : JSON.stringify(data);
    }
    return fetchFn(url, init).then(async (res) => {
      if (timer) clearTimeout(timer);
      const text = await res.text();
      let parsed: any = text;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch (_) {
          parsed = text;
        }
      }
      return { statusCode: res.status, data: parsed };
    }).catch((e) => {
      if (timer) clearTimeout(timer);
      throw e instanceof Error ? e : new Error(String(e));
    });
  }

  private _isDevtools(): boolean {
    if (!this.isMinigame) return false;
    try {
      const info = this._api?.getSystemInfoSync?.();
      if (!info) return false;
      const platform = String(info.platform || '').toLowerCase();
      const brand = String(info.brand || '').toLowerCase();
      const model = String(info.model || '').toLowerCase();
      const environment = String(info.environment || '').toLowerCase();
      return platform === 'devtools'
        || brand === 'devtools'
        || environment === 'devtools'
        || model.includes('devtools');
    } catch (_) {
      return false;
    }
  }

  loginCode(): Promise<string> {
    return new Promise((resolve) => {
      if (!this._api || typeof this._api.login !== 'function') {
        resolve('');
        return;
      }
      try {
        this._api.login({
          success: (res: any) => resolve(res?.code || ''),
          fail: () => resolve(''),
        });
      } catch (_) {
        resolve('');
      }
    });
  }

  getSystemInfoSync(): any {
    try {
      return this._api?.getSystemInfoSync?.() || null;
    } catch (_) {
      return null;
    }
  }

  restartMiniProgram(): boolean {
    try {
      if (typeof this._api?.restartMiniProgram !== 'function') return false;
      this._api.restartMiniProgram();
      return true;
    } catch (e) {
      console.warn('[Platform] restartMiniProgram 失败:', e);
      return false;
    }
  }

  onHide(callback: () => void): void {
    try { this._api?.onHide?.(callback); } catch (_) {}
  }

  onShow(callback: (res?: any) => void): void {
    try { this._api?.onShow?.(callback); } catch (_) {}
  }

  setClipboard(text: string): void {
    try {
      if (this._api?.setClipboardData) {
        this._api.setClipboardData({ data: text });
        return;
      }
    } catch (_) {}
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(text);
      }
    } catch (_) {}
  }

  showToast(title: string, icon: 'success' | 'none' | 'error' = 'none'): void {
    try {
      if (this._api?.showToast) {
        this._api.showToast({ title, icon, duration: 2000 });
        return;
      }
    } catch (_) {}
    console.log('[Toast]', title);
  }

  /** MVP 先直接发奖励；接广告后接到这里。 */
  showRewardedVideo(onReward: () => void): void {
    this.showToast('广告位稍后接入', 'none');
    onReward();
  }
}

const _global: any = typeof GameGlobal !== 'undefined' ? GameGlobal : globalThis;
if (!_global.__platformService) {
  _global.__platformService = new PlatformServiceClass();
}
export const Platform: PlatformServiceClass = _global.__platformService;
