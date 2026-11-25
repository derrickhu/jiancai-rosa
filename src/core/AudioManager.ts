/**
 * 对齐花花：逻辑路径一律 `subpkg_audio/*.mp3`，整目录 CDN。
 * 路径解析内存缓存 + 高频短音效 55ms 防连点节流 + 微信/抖音固定上限 8 槽位 InnerAudioContext 复用池（零原生句柄泄漏）。
 */
import { AUDIO_SETTINGS_KEY } from '@/config/CloudConfig';
import { CdnAssetService } from '@/core/CdnAssetService';
import { PersistService } from '@/core/PersistService';
import { Platform } from '@/core/PlatformService';

export const SFX_IDS = [
  'ui_click',
  'ui_open',
  'ui_close',
  'ui_deny',
  'coin_gain',
  'coin_spend',
  'fridge_open',
  'cook_sizzle',
  'cook_done',
  'cook_ready',
  'xp_gain',
  'eat',
  'level_up',
  'upgrade',
  'recipe_paper',
  'outing',
  'walk',
  'rummage',
  'item_reveal',
  'pickup_veg',
  'pickup_wet',
  'pickup_god',
  'basket_place',
  'basket_discard',
  'gather',
  'event_pop',
  'result_safe',
  'result_dusk',
  'tutorial_pop',
  'tutorial_hint',
  'tutorial_ok',
] as const;

export type SfxId = typeof SFX_IDS[number];

export type MarketBgmId =
  | 'market_xiangko'
  | 'market_heyan'
  | 'market_shanwu'
  | 'market_jiangbian'
  | 'market_laocheng';

export type BgmId = 'kitchen' | 'outing' | MarketBgmId;

const MARKET_BGM: Record<string, MarketBgmId> = {
  xiangko: 'market_xiangko',
  heyan: 'market_heyan',
  qiaotou: 'market_heyan',
  shanwu: 'market_shanwu',
  jiangbian: 'market_jiangbian',
  nanshi: 'market_laocheng',
  laocheng: 'market_laocheng',
  dukou: 'market_jiangbian',
  shanzhen: 'market_laocheng',
  guoyuan: 'market_heyan',
  tiantou: 'market_shanwu',
  futou: 'market_jiangbian',
};

const AUDIO_DIR = 'subpkg_audio';
const BGM_VOL = 0.42;
const SFX_VOL = 0.86;
const REVEAL_VOL = 0.7;
const PICKUP_SFX = new Set<SfxId>(['pickup_veg', 'pickup_wet']);
const PICKUP_VOL = 0.46;
/** 结算 / 神捡 / 升级：压过 BGM 的爽感短句 */
const REWARD_SFX = new Set<SfxId>(['result_safe', 'result_dusk', 'pickup_god', 'level_up', 'cook_ready']);
const REWARD_VOL = 1;
/** 高频短音效最小重入间隔（防止连点瞬间并发轰炸音频桥） */
const SFX_THROTTLE_MS = 55;
const THROTTLED_SFX = new Set<SfxId>([
  'ui_click',
  'pickup_veg',
  'pickup_wet',
  'rummage',
  'basket_place',
  'walk',
]);
/** 微信/抖音常驻复用音频槽位上限（彻底杜绝短音效不触发 onEnded 导致的原生 AVAudioPlayer 泄漏） */
const MAX_WX_SFX_POOL = 8;
const TAG = '[Audio]';

interface AudioSettings {
  musicEnabled: boolean;
  soundEnabled: boolean;
}

type WxInnerAudioContext = {
  src: string;
  loop: boolean;
  volume: number;
  autoplay?: boolean;
  obeyMuteSwitch?: boolean;
  play: () => void;
  pause: () => void;
  stop?: () => void;
  destroy?: () => void;
  seek?: (position: number) => void;
  onError?: (handler: (error: unknown) => void) => void;
  onEnded?: (handler: () => void) => void;
  onCanplay?: (handler: () => void) => void;
  onPlay?: (handler: () => void) => void;
};

interface WxSfxSlot {
  ctx: WxInnerAudioContext;
  src: string;
  logical: string;
  name: SfxId | string;
  busy: boolean;
  lastUsedSeq: number;
  usedHttps: boolean;
  playTimer: ReturnType<typeof setTimeout> | null;
}

interface AudioSettingsState {
  musicEnabled: boolean;
  soundEnabled: boolean;
}

class AudioManagerClass {
  private wxBgm: WxInnerAudioContext | null = null;
  private webBgm: HTMLAudioElement | null = null;
  private initialized = false;
  private firstGestureBound = false;
  private hidden = false;
  private musicEnabled = this.readSettings().musicEnabled;
  private soundEnabled = this.readSettings().soundEnabled;
  private bgmId: BgmId | null = null;
  private bgmSrc = '';
  private bgmLogical = '';
  private bgmRequestSeq = 0;
  private bgmHttpsTried = false;
  private readonly webSfxPool = new Map<string, HTMLAudioElement>();
  private readonly wxSfxPool: WxSfxSlot[] = [];
  private readonly _resolvedSfx = new Map<SfxId, string>();
  private readonly _lastSfxAt = new Map<SfxId, number>();
  private _sfxUseSeq = 0;
  private revealToken = 0;
  private revealSlot: WxSfxSlot | null = null;

  sfxPath(id: SfxId): string {
    if (id === 'tutorial_pop' || id === 'tutorial_hint' || id === 'tutorial_ok') {
      return `subpkg_kitchen/${id}.mp3`;
    }
    return `${AUDIO_DIR}/${id}.mp3`;
  }

  bgmPath(id: BgmId): string {
    return `${AUDIO_DIR}/bgm_${id}.mp3`;
  }

  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.bindFirstGestureReplay();
    Platform.onHide(() => {
      this.hidden = true;
      this.pauseBackgroundMusic();
      this.stopAllWxSfx();
    });
    Platform.onShow(() => {
      this.hidden = false;
      if (this.musicEnabled) this.playBackgroundMusic();
    });
  }

  preloadSfx(): Promise<void> {
    this.init();
    return CdnAssetService.preloadPaths(SFX_IDS.map((id) => this.sfxPath(id)))
      .then(async () => {
        await Promise.all(
          SFX_IDS.map(async (id) => {
            if (this._resolvedSfx.has(id)) return;
            try {
              const src = await CdnAssetService.resolveAudioSrc(this.sfxPath(id));
              if (src) this._resolvedSfx.set(id, src);
            } catch (_) { /* ignore */ }
          }),
        );
      })
      .catch((err) => {
        console.warn(TAG, '音效预加载失败', err);
      });
  }

  isMusicEnabled(): boolean {
    return this.musicEnabled;
  }

  isSoundEnabled(): boolean {
    return this.soundEnabled;
  }

  isMuted(): boolean {
    return !this.musicEnabled && !this.soundEnabled;
  }

  setMuted(muted: boolean): void {
    this.musicEnabled = !muted;
    this.soundEnabled = !muted;
    this.writeSettings();
    if (muted) {
      this.pauseBackgroundMusic();
      this.stopAllWxSfx();
    } else {
      this.playBackgroundMusic();
    }
  }

  toggleMuted(): void {
    this.setMuted(!this.isMuted());
  }

  play(id: SfxId, volume = PICKUP_SFX.has(id) ? PICKUP_VOL : REWARD_SFX.has(id) ? REWARD_VOL : SFX_VOL): void {
    if (!this.soundEnabled || this.hidden) return;
    if (THROTTLED_SFX.has(id)) {
      const now = Date.now();
      const prev = this._lastSfxAt.get(id) ?? 0;
      if (now - prev < SFX_THROTTLE_MS) return;
      this._lastSfxAt.set(id, now);
    }

    this.init();
    const logical = this.sfxPath(id);
    const cachedSrc = this._resolvedSfx.get(id);
    if (cachedSrc) {
      this.playResolvedSfx(id, cachedSrc, volume, logical);
      return;
    }

    const token = this.revealToken;
    void CdnAssetService.resolveAudioSrc(logical)
      .then((src) => {
        if (src) this._resolvedSfx.set(id, src);
        if (!this.soundEnabled || this.hidden) return;
        if (id === 'item_reveal' && token !== this.revealToken) return;
        this.playResolvedSfx(id, src, volume, logical);
      })
      .catch((err) => {
        console.warn(TAG, `音效 "${id}" 资源未就绪`, err);
      });
  }

  playPickup(zone: 'dry' | 'wet'): void {
    this.play(zone === 'wet' ? 'pickup_wet' : 'pickup_veg');
  }

  /** 物品出现：花花那条组合短句。连出时重触发，避免好几条叠在一起刺耳。 */
  playGain(_opts?: { god?: boolean }): void {
    this.revealToken += 1;
    this.stopRevealWx();
    this.play('item_reveal', REVEAL_VOL);
  }

  playMarketBgm(marketId: string): void {
    this.playBgm(MARKET_BGM[marketId] ?? 'market_xiangko');
  }

  get currentBgmId(): BgmId | null {
    return this.bgmId;
  }

  playBgm(id: BgmId): void {
    this.init();
    if (this.bgmId === id && this.bgmSrc) {
      this.playBackgroundMusic();
      return;
    }
    const logical = this.bgmPath(id);
    this.bgmId = id;
    this.bgmLogical = logical;
    this.bgmHttpsTried = false;
    const seq = ++this.bgmRequestSeq;
    void CdnAssetService.resolveAudioSrc(logical)
      .then((src) => {
        if (seq !== this.bgmRequestSeq) return;
        this.switchBackgroundMusic(src);
      })
      .catch((err) => {
        if (seq !== this.bgmRequestSeq) return;
        console.warn(TAG, `BGM "${logical}" 资源未就绪`, err);
      });
  }

  playBackgroundMusic(): void {
    if (!this.musicEnabled || this.hidden || !this.bgmSrc) return;
    this.init();
    try {
      this.wxBgm?.play();
      void this.webBgm?.play?.();
    } catch (_) {}
  }

  pauseBackgroundMusic(): void {
    try {
      this.wxBgm?.pause();
      this.webBgm?.pause?.();
    } catch (_) {}
  }

  private stopRevealWx(): void {
    const slot = this.revealSlot;
    this.revealSlot = null;
    if (!slot) return;
    this._resetSlotTimer(slot);
    slot.busy = false;
    try { slot.ctx.stop?.(); } catch (_) {}
  }

  private stopAllWxSfx(): void {
    this.revealSlot = null;
    for (const slot of this.wxSfxPool) {
      this._resetSlotTimer(slot);
      slot.busy = false;
      try { slot.ctx.stop?.(); } catch (_) {}
    }
  }

  private _resetSlotTimer(slot: WxSfxSlot): void {
    if (slot.playTimer !== null) {
      clearTimeout(slot.playTimer);
      slot.playTimer = null;
    }
  }

  private _createWxSfxSlot(): WxSfxSlot | null {
    const ctx = Platform.createInnerAudioContext() as WxInnerAudioContext | null;
    if (!ctx) return null;

    ctx.loop = false;
    ctx.autoplay = false;
    ctx.obeyMuteSwitch = false;

    const slot: WxSfxSlot = {
      ctx,
      src: '',
      logical: '',
      name: '',
      busy: false,
      lastUsedSeq: 0,
      usedHttps: false,
      playTimer: null,
    };

    ctx.onEnded?.(() => {
      this._resetSlotTimer(slot);
      slot.busy = false;
      if (this.revealSlot === slot) this.revealSlot = null;
    });

    ctx.onCanplay?.(() => {
      if (!slot.busy || slot.playTimer === null) return;
      this._resetSlotTimer(slot);
      try {
        slot.ctx.play();
      } catch (err) {
        slot.busy = false;
        console.warn(TAG, `音效 "${slot.name}" play()`, err);
      }
    });

    ctx.onError?.((error) => {
      this._resetSlotTimer(slot);
      const https = slot.logical && CdnAssetService.isCdnPath(slot.logical)
        ? CdnAssetService.publicUrl(slot.logical)
        : '';
      if (!slot.usedHttps && https && slot.src !== https) {
        slot.usedHttps = true;
        slot.src = https;
        if (SFX_IDS.includes(slot.name as SfxId)) {
          this._resolvedSfx.set(slot.name as SfxId, https);
        }
        try {
          slot.ctx.src = https;
          slot.playTimer = globalThis.setTimeout(
            () => {
              slot.playTimer = null;
              if (!slot.busy) return;
              try { slot.ctx.play(); } catch (_) { slot.busy = false; }
            },
            typeof slot.ctx.onCanplay === 'function' ? 300 : 0,
          );
        } catch (_) {
          slot.busy = false;
        }
        return;
      }
      slot.busy = false;
      if (this.revealSlot === slot) this.revealSlot = null;
      const msg = error && typeof error === 'object' && 'errMsg' in error
        ? String((error as { errMsg?: string }).errMsg)
        : String(error);
      console.warn(TAG, `音效 "${slot.name}" 播放失败`, msg);
    });

    this.wxSfxPool.push(slot);
    return slot;
  }

  private _acquireWxSfxSlot(targetSrc: string): WxSfxSlot | null {
    // 1. 优先命中同 src 的空闲槽位（无需重设 src，直接 seek(0) + play() 零解码延迟）
    for (const slot of this.wxSfxPool) {
      if (!slot.busy && slot.src === targetSrc) return slot;
    }
    // 2. 任意空闲槽位
    for (const slot of this.wxSfxPool) {
      if (!slot.busy) return slot;
    }
    // 3. 池未满 8 个则扩容创建
    if (this.wxSfxPool.length < MAX_WX_SFX_POOL) {
      return this._createWxSfxSlot();
    }
    // 4. 池已满 8 个：复用最老槽位（避开正在播的重要结算短句或取最早启动实例）
    let oldest = this.wxSfxPool[0];
    for (let i = 1; i < this.wxSfxPool.length; i++) {
      if (this.wxSfxPool[i].lastUsedSeq < oldest.lastUsedSeq) {
        oldest = this.wxSfxPool[i];
      }
    }
    return oldest;
  }

  private playResolvedSfx(name: SfxId | string, src: string, volume: number, logical?: string): void {
    if (Platform.isMinigame) {
      const slot = this._acquireWxSfxSlot(src);
      if (slot) {
        if (name === 'item_reveal') {
          this.stopRevealWx();
          this.revealSlot = slot;
        }
        this._playOnWxSlot(slot, name, src, volume, logical);
        return;
      }
    }
    if (typeof Audio !== 'undefined') this.playWebSfx(src, volume);
  }

  private _playOnWxSlot(
    slot: WxSfxSlot,
    name: SfxId | string,
    src: string,
    volume: number,
    logical?: string,
  ): void {
    this._resetSlotTimer(slot);
    try { slot.ctx.stop?.(); } catch (_) {}

    slot.name = name;
    slot.logical = logical || '';
    slot.busy = true;
    slot.lastUsedSeq = ++this._sfxUseSeq;
    slot.ctx.loop = false;
    slot.ctx.volume = Math.max(0, Math.min(1, volume));
    slot.ctx.obeyMuteSwitch = false;

    if (slot.src === src && src) {
      try { slot.ctx.seek?.(0); } catch (_) {}
      try {
        slot.ctx.play();
      } catch (err) {
        slot.busy = false;
        console.warn(TAG, `音效 "${name}" replay()`, err);
      }
      return;
    }

    slot.usedHttps = false;
    slot.src = src;
    slot.playTimer = globalThis.setTimeout(
      () => {
        slot.playTimer = null;
        if (!slot.busy) return;
        try {
          slot.ctx.play();
        } catch (err) {
          slot.busy = false;
          console.warn(TAG, `音效 "${name}" play()`, err);
        }
      },
      typeof slot.ctx.onCanplay === 'function' ? 300 : 0,
    );
    try {
      slot.ctx.src = src;
    } catch (err) {
      this._resetSlotTimer(slot);
      slot.busy = false;
      console.warn(TAG, `音效 "${name}" set src`, err);
    }
  }

  private playWebSfx(src: string, volume: number): void {
    let sfx = this.webSfxPool.get(src);
    if (!sfx) {
      sfx = new Audio(src);
      sfx.preload = 'auto';
      this.webSfxPool.set(src, sfx);
    }
    try {
      sfx.volume = Math.max(0, Math.min(1, volume));
      sfx.currentTime = 0;
      void sfx.play();
    } catch (_) {}
  }

  private bindFirstGestureReplay(): void {
    if (this.firstGestureBound) return;
    this.firstGestureBound = true;
    const api = Platform.api;
    if (api?.onTouchStart) {
      api.onTouchStart(() => this.playBackgroundMusic());
      return;
    }
    const root = globalThis as any;
    root.addEventListener?.('pointerdown', () => this.playBackgroundMusic(), { once: true });
    root.addEventListener?.('touchstart', () => this.playBackgroundMusic(), { once: true });
  }

  private switchBackgroundMusic(src: string): void {
    this.bgmSrc = src;
    if (!this.initialized) this.init();
    try {
      if (!this.wxBgm) {
        const ctx = Platform.createInnerAudioContext() as WxInnerAudioContext | null;
        if (ctx) {
          ctx.loop = true;
          ctx.volume = BGM_VOL;
          ctx.autoplay = false;
          ctx.obeyMuteSwitch = false;
          ctx.onError?.((error) => {
            const https = this.bgmLogical && CdnAssetService.isCdnPath(this.bgmLogical)
              ? CdnAssetService.publicUrl(this.bgmLogical)
              : '';
            if (!this.bgmHttpsTried && https && this.wxBgm && this.wxBgm.src !== https) {
              this.bgmHttpsTried = true;
              try {
                this.wxBgm.src = https;
                this.bgmSrc = https;
              } catch (_) {}
              return;
            }
            console.warn(TAG, 'BGM failed', this.bgmSrc || src, error);
          });
          if (typeof ctx.onCanplay === 'function') {
            ctx.onCanplay(() => this.playBackgroundMusic());
          }
          this.wxBgm = ctx;
        }
      }
      if (this.wxBgm) {
        this.wxBgm.pause();
        this.wxBgm.src = src;
        this.wxBgm.loop = true;
        this.wxBgm.volume = BGM_VOL;
      }
      if (typeof Audio !== 'undefined' && !this.wxBgm) {
        if (!this.webBgm) this.webBgm = new Audio(src);
        else this.webBgm.src = src;
        this.webBgm.loop = true;
        this.webBgm.volume = BGM_VOL;
        this.webBgm.load();
      }
    } catch (_) {}
    setTimeout(() => this.playBackgroundMusic(), this.wxBgm && typeof this.wxBgm.onCanplay === 'function' ? 300 : 0);
  }

  private readSettings(): AudioSettingsState {
    const stored = PersistService.readJSON<Partial<AudioSettings>>(AUDIO_SETTINGS_KEY);
    return {
      musicEnabled: stored?.musicEnabled !== false,
      soundEnabled: stored?.soundEnabled !== false,
    };
  }

  private writeSettings(): void {
    PersistService.writeJSON(AUDIO_SETTINGS_KEY, {
      musicEnabled: this.musicEnabled,
      soundEnabled: this.soundEnabled,
    }, { markDirty: false });
  }
}

const holder = typeof GameGlobal !== 'undefined' ? GameGlobal : globalThis;
if (!(holder as any).__jiancaiAudioManager) {
  (holder as any).__jiancaiAudioManager = new AudioManagerClass();
}

export const AudioManager: AudioManagerClass = (holder as any).__jiancaiAudioManager;
