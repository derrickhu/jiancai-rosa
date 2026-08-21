import { detectMinigamePlatform, getNativePlatformApi, type PlatformName } from './platformDetect';

class PlatformServiceClass {
  readonly name: PlatformName;
  private readonly _api: any;

  constructor() {
    this.name = detectMinigamePlatform();
    this._api = getNativePlatformApi(this.name);
  }

  get isMinigame(): boolean {
    return this.name === 'wechat' || this.name === 'douyin';
  }

  get api(): any {
    return this._api;
  }

  createImage(): any {
    if (this._api?.createImage) return this._api.createImage();
    if (typeof Image !== 'undefined') return new (Image as any)();
    return { src: '', onload: null, onerror: null };
  }

  getStorageSync(key: string): string | null {
    try {
      if (this._api?.getStorageSync) {
        return this._api.getStorageSync(key) || null;
      }
      if (typeof localStorage !== 'undefined') return localStorage.getItem(key);
    } catch (_) {}
    return null;
  }

  setStorageSync(key: string, value: string): void {
    try {
      if (this._api?.setStorageSync) {
        this._api.setStorageSync(key, value);
        return;
      }
      if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
    } catch (_) {}
  }

  removeStorageSync(key: string): void {
    try {
      if (this._api?.removeStorageSync) {
        this._api.removeStorageSync(key);
        return;
      }
      if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
    } catch (_) {}
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
