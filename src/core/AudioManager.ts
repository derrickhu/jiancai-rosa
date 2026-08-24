/**
 * 对齐花花：逻辑路径一律 `subpkg_audio/*.mp3`，整目录 CDN。
 * 播放前 resolveAudioSrc：真机用 wxfile 缓存，开发者工具 http://usr 改走 https。
 * 设 src 后等 onCanplay 再 play；本地读失败再回落 CDN https。
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
  shanwu: 'market_shanwu',
  jiangbian: 'market_jiangbian',
  laocheng: 'market_laocheng',
};

const AUDIO_DIR = 'subpkg_audio';
const BGM_VOL = 0.42;
const SFX_VOL = 0.86;
/** 捡到菜 / 结算：压过 BGM 的爽感短句 */
const REWARD_SFX = new Set<SfxId>(['item_reveal', 'result_safe', 'result_dusk', 'pickup_god']);
const REWARD_VOL = 1;
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

  sfxPath(id: SfxId): string {
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
    });
    Platform.onShow(() => {
      this.hidden = false;
      if (this.musicEnabled) this.playBackgroundMusic();
    });
  }

  preloadSfx(): Promise<void> {
    this.init();
    return CdnAssetService.preloadPaths(SFX_IDS.map((id) => this.sfxPath(id))).catch((err) => {
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
    if (muted) this.pauseBackgroundMusic();
    else this.playBackgroundMusic();
  }

  toggleMuted(): void {
    this.setMuted(!this.isMuted());
  }

  play(id: SfxId, volume = REWARD_SFX.has(id) ? REWARD_VOL : SFX_VOL): void {
    if (!this.soundEnabled) return;
    this.init();
    const logical = this.sfxPath(id);
    void CdnAssetService.resolveAudioSrc(logical)
      .then((src) => this.playResolvedSfx(id, src, volume, logical))
      .catch((err) => {
        console.warn(TAG, `音效 "${id}" 资源未就绪`, err);
      });
  }

  playPickup(zone: 'dry' | 'wet'): void {
    this.play(zone === 'wet' ? 'pickup_wet' : 'pickup_veg');
  }

  /** 任意途径有物品出现：同一首出现音。神捡演出另走 pickup_god。 */
  playGain(_opts?: { god?: boolean }): void {
    this.play('item_reveal');
  }

  playMarketBgm(marketId: string): void {
    this.playBgm(MARKET_BGM[marketId] ?? 'market_xiangko');
  }

  playBgm(id: BgmId): void {
    this.init();
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

  private playResolvedSfx(name: string, src: string, volume: number, logical?: string): void {
    const wxCtx = Platform.createInnerAudioContext() as WxInnerAudioContext | null;
    if (wxCtx) {
      this.playWxSfx(name, wxCtx, src, volume, logical);
      return;
    }
    if (typeof Audio !== 'undefined') this.playWebSfx(src, volume);
  }

  private playWxSfx(
    name: string,
    audio: WxInnerAudioContext,
    src: string,
    volume: number,
    logical?: string,
  ): void {
    let done = false;
    let started = false;
    let usedHttps = false;
    const https = logical && CdnAssetService.isCdnPath(logical) ? CdnAssetService.publicUrl(logical) : '';
    const cleanup = () => {
      if (done) return;
      done = true;
      try { audio.destroy?.(); } catch (_) {}
    };
    const tryPlay = () => {
      if (done || started) return;
      started = true;
      try {
        audio.play();
      } catch (error) {
        console.warn(TAG, `音效 "${name}" play()`, error);
        cleanup();
      }
    };

    audio.loop = false;
    audio.volume = Math.max(0, Math.min(1, volume));
    audio.obeyMuteSwitch = false;
    audio.onError?.((error) => {
      if (!usedHttps && https && src !== https) {
        usedHttps = true;
        started = false;
        try {
          audio.src = https;
          setTimeout(() => tryPlay(), typeof audio.onCanplay === 'function' ? 300 : 0);
        } catch (_) {
          cleanup();
        }
        return;
      }
      console.warn(TAG, `音效 "${name}" 播放失败`, error);
      cleanup();
    });
    audio.onEnded?.(() => cleanup());
    if (typeof audio.onCanplay === 'function') {
      audio.onCanplay(() => tryPlay());
    }
    audio.src = src;
    setTimeout(() => tryPlay(), typeof audio.onCanplay === 'function' ? 300 : 0);
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
