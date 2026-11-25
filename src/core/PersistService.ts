import {
  CLOUD_SYNC_ALLOWLIST,
  CLOUD_SYNC_META_KEY,
  CLOUD_SYNC_SCHEMA_VERSION,
  GAME_KEY,
  SAVE_KEY,
} from '@/config/CloudConfig';
import { Platform } from './PlatformService';

/** 独立赶集实时断点存储键（仅本地快照，与主存档及云同步 dirty 标记解耦互不污染）。 */
export const OUTING_CHECKPOINT_KEY = `${GAME_KEY}_outing_checkpoint_v1`;

const ASYNC_FLUSH_DEBOUNCE_MS = 260;

export interface CloudSyncMeta {
  updatedAt: number;
  dirty: boolean;
  lastSyncAt: number;
  /** 最近一次确认过的云端版本；本地缓存上行必须基于这个版本。 */
  remoteUpdatedAt: number;
}

export interface PersistSnapshot {
  schemaVersion: number;
  updatedAt: number;
  baseRemoteUpdatedAt: number;
  payload: Record<string, string>;
  payloadKeys: string[];
  sizeBytes: number;
}

type DirtyListener = (changedKeys: string[]) => void;
export type CloudImportReason = 'startup' | 'startup-late' | 'stale-update' | 'manual';
export interface CloudImportInfo {
  reason: CloudImportReason;
  updatedAt: number;
  changedKeys: string[];
  payloadKeys: string[];
}
export type CloudImportListener = (info: CloudImportInfo) => void;

interface WriteOptions {
  markDirty?: boolean;
}

class PersistServiceClass {
  private readonly _allowlist = new Set<string>(CLOUD_SYNC_ALLOWLIST);
  private readonly _listeners = new Set<DirtyListener>();
  private readonly _importListeners = new Set<CloudImportListener>();
  private readonly _beforeFlushHooks = new Set<() => void>();
  private _dirtyTrackingSuspended = 0;

  /** 权威内存缓存：命中后 0ms 零跨桥读取，确保快照与业务逻辑实时一致。 */
  private readonly _memCache = new Map<string, string | null>();
  /** 待异步落盘脏键值（null 表示删除）。 */
  private readonly _dirtyStorage = new Map<string, string | null>();
  /** 内存缓存 CloudSyncMeta，消除每次数据变更重复 JSON.parse。 */
  private _cloudMetaCache: CloudSyncMeta | null = null;
  private _flushTimer: ReturnType<typeof setTimeout> | null = null;
  private _flushingSync = false;
  private _immediateSyncWindow = false;
  private _immediateSyncResetTimer: ReturnType<typeof setTimeout> | null = null;
  private _hooksBound = false;

  constructor() {
    this._bindLifecycleSafetyHooks();
  }

  /** 是否正处于切后台 / 页面卸载紧急同步刷盘窗口。 */
  get isImmediateSyncActive(): boolean {
    return this._immediateSyncWindow;
  }

  onBeforeFlush(hook: () => void): () => void {
    this._beforeFlushHooks.add(hook);
    return () => this._beforeFlushHooks.delete(hook);
  }

  getAllowlistKeys(): readonly string[] {
    return CLOUD_SYNC_ALLOWLIST;
  }

  isCloudSyncKey(key: string): boolean {
    return this._allowlist.has(key);
  }

  readRaw(key: string): string | null {
    if (this._memCache.has(key)) {
      return this._memCache.get(key) ?? null;
    }
    const val = Platform.getStorageSync(key);
    this._memCache.set(key, val);
    return val;
  }

  readJSON<T>(key: string): T | null {
    const raw = this.readRaw(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch (e) {
      console.warn(`[Persist] JSON 读取失败 key=${key}:`, e);
      return null;
    }
  }

  writeRaw(key: string, value: string, options: WriteOptions = {}): void {
    this._setLocalRaw(key, value);
    if (options.markDirty !== false) {
      this._onDataChanged([key]);
    }
  }

  writeJSON(key: string, value: unknown, options: WriteOptions = {}): void {
    this.writeRaw(key, JSON.stringify(value), options);
  }

  remove(key: string, options: WriteOptions = {}): void {
    this._removeLocalRaw(key);
    if (options.markDirty !== false) {
      this._onDataChanged([key]);
    }
  }

  readOutingCheckpoint<T>(): T | null {
    return this.readJSON<T>(OUTING_CHECKPOINT_KEY);
  }

  writeOutingCheckpoint(value: unknown): void {
    this.writeJSON(OUTING_CHECKPOINT_KEY, value, { markDirty: false });
  }

  clearOutingCheckpoint(): void {
    this.remove(OUTING_CHECKPOINT_KEY, { markDirty: false });
  }

  /**
   * 紧急同步落盘：立即执行前置聚合钩子（如赶集待定断点、埋点待写队列）并将全部未落盘键值同步刷入磁盘。
   * 仅在 onHide / onMemoryWarning / visibilitychange(hidden) / pagehide / beforeunload / restartMiniProgram 调用。
   */
  flushAllSync(): void {
    if (this._flushingSync) return;
    this._flushingSync = true;
    try {
      for (const hook of this._beforeFlushHooks) {
        try {
          hook();
        } catch (e) {
          console.warn('[Persist] beforeFlush hook 执行失败:', e);
        }
      }

      if (this._flushTimer !== null) {
        clearTimeout(this._flushTimer);
        this._flushTimer = null;
      }

      if (this._dirtyStorage.size === 0) return;
      const entries = [...this._dirtyStorage.entries()];
      this._dirtyStorage.clear();

      for (const [key, val] of entries) {
        if (val === null) {
          Platform.removeStorageSync(key);
        } else {
          Platform.setStorageSync(key, val);
        }
      }
    } finally {
      this._flushingSync = false;
    }
  }

  subscribe(listener: DirtyListener): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  subscribeCloudImport(listener: CloudImportListener): () => void {
    this._importListeners.add(listener);
    return () => this._importListeners.delete(listener);
  }

  withSuppressedDirtyTracking<T>(runner: () => T): T {
    this._dirtyTrackingSuspended++;
    try {
      return runner();
    } finally {
      this._dirtyTrackingSuspended = Math.max(0, this._dirtyTrackingSuspended - 1);
    }
  }

  getCloudSyncMeta(): CloudSyncMeta {
    if (this._cloudMetaCache) {
      return { ...this._cloudMetaCache };
    }
    const parsed = this.readJSON<Partial<CloudSyncMeta>>(CLOUD_SYNC_META_KEY);
    if (parsed && typeof parsed.updatedAt === 'number') {
      this._cloudMetaCache = {
        updatedAt: parsed.updatedAt,
        dirty: !!parsed.dirty,
        lastSyncAt: typeof parsed.lastSyncAt === 'number' ? parsed.lastSyncAt : 0,
        remoteUpdatedAt: typeof parsed.remoteUpdatedAt === 'number' ? parsed.remoteUpdatedAt : 0,
      };
      return { ...this._cloudMetaCache };
    }

    this._cloudMetaCache = {
      updatedAt: this._inferInitialUpdatedAt(),
      dirty: false,
      lastSyncAt: 0,
      remoteUpdatedAt: 0,
    };
    return { ...this._cloudMetaCache };
  }

  isCloudDirty(): boolean {
    return this.getCloudSyncMeta().dirty;
  }

  touchCloudMeta(updatedAt = Date.now()): CloudSyncMeta {
    const prev = this.getCloudSyncMeta();
    const next: CloudSyncMeta = {
      updatedAt,
      dirty: true,
      lastSyncAt: prev.lastSyncAt,
      remoteUpdatedAt: prev.remoteUpdatedAt,
    };
    this._writeMeta(next);
    return next;
  }

  markCloudSynced(updatedAt: number): void {
    const prev = this.getCloudSyncMeta();
    this._writeMeta({
      updatedAt: updatedAt > 0 ? updatedAt : prev.updatedAt,
      dirty: false,
      lastSyncAt: Date.now(),
      remoteUpdatedAt: updatedAt > 0 ? updatedAt : prev.remoteUpdatedAt,
    });
  }

  exportCloudSnapshot(): PersistSnapshot {
    const meta = this.getCloudSyncMeta();
    const payload: Record<string, string> = {};
    let sizeBytes = 0;

    for (const key of CLOUD_SYNC_ALLOWLIST) {
      const raw = this.readRaw(key);
      if (raw === null) continue;
      payload[key] = raw;
      sizeBytes += raw.length;
    }

    const payloadKeys = Object.keys(payload);

    return {
      schemaVersion: CLOUD_SYNC_SCHEMA_VERSION,
      updatedAt: meta.updatedAt,
      baseRemoteUpdatedAt: meta.remoteUpdatedAt,
      payload,
      payloadKeys,
      sizeBytes,
    };
  }

  importCloudSnapshot(snapshot: {
    updatedAt?: number;
    payload?: Record<string, unknown>;
    reason?: CloudImportReason;
    replaceMissingKeys?: boolean;
  }): void {
    const payload = snapshot.payload || {};
    const payloadKeyCount = Object.keys(payload).length;
    const replaceMissingKeys = snapshot.replaceMissingKeys ?? (payloadKeyCount === 0);
    const updatedAt = typeof snapshot.updatedAt === 'number' ? snapshot.updatedAt : Date.now();
    const changedKeys: string[] = [];
    const preservedLocalKeys: string[] = [];

    this.withSuppressedDirtyTracking(() => {
      for (const key of CLOUD_SYNC_ALLOWLIST) {
        if (Object.prototype.hasOwnProperty.call(payload, key)) {
          const value = payload[key];
          if (value === undefined || value === null) {
            if (this.readRaw(key) !== null) changedKeys.push(key);
            this._removeLocalRaw(key);
          } else {
            const raw = typeof value === 'string' ? value : JSON.stringify(value);
            if (this.readRaw(key) !== raw) changedKeys.push(key);
            this._setLocalRaw(key, raw);
          }
        } else if (replaceMissingKeys) {
          if (this.readRaw(key) !== null) changedKeys.push(key);
          this._removeLocalRaw(key);
        } else if (this.readRaw(key) !== null) {
          preservedLocalKeys.push(key);
        }
      }

      this._writeMeta({
        updatedAt,
        dirty: preservedLocalKeys.length > 0,
        lastSyncAt: Date.now(),
        remoteUpdatedAt: updatedAt,
      });
    });

    if (preservedLocalKeys.length > 0) {
      console.warn(
        `[Persist] 云端档缺少本地资产 key，已保留并标记待上行: ${preservedLocalKeys.join(', ')}`,
      );
    }

    const payloadKeys = Object.keys(payload);
    for (const listener of this._importListeners) {
      try {
        listener({
          reason: snapshot.reason || 'manual',
          updatedAt,
          changedKeys,
          payloadKeys,
        });
      } catch (e) {
        console.warn('[Persist] cloud import listener 执行失败:', e);
      }
    }
  }

  private _onDataChanged(changedKeys: string[]): void {
    if (this._dirtyTrackingSuspended > 0) return;

    const syncKeys = changedKeys.filter((key) => this.isCloudSyncKey(key));
    if (syncKeys.length === 0) return;

    const updatedAt = Date.now();
    const prev = this.getCloudSyncMeta();
    this._writeMeta({
      updatedAt,
      dirty: true,
      lastSyncAt: prev.lastSyncAt,
      remoteUpdatedAt: prev.remoteUpdatedAt,
    });

    for (const listener of this._listeners) {
      try {
        listener(syncKeys);
      } catch (e) {
        console.warn('[Persist] dirty listener 执行失败:', e);
      }
    }
  }

  private _inferInitialUpdatedAt(): number {
    const raw = this.readRaw(SAVE_KEY);
    if (!raw) return 0;
    try {
      const parsed = JSON.parse(raw) as { lastSeenAt?: number };
      return typeof parsed.lastSeenAt === 'number' ? parsed.lastSeenAt : 0;
    } catch (_) {
      return 0;
    }
  }

  private _writeMeta(meta: CloudSyncMeta): void {
    const copy: CloudSyncMeta = {
      updatedAt: meta.updatedAt,
      dirty: meta.dirty,
      lastSyncAt: meta.lastSyncAt,
      remoteUpdatedAt: meta.remoteUpdatedAt,
    };
    this._cloudMetaCache = copy;
    this.withSuppressedDirtyTracking(() => {
      this._setLocalRaw(CLOUD_SYNC_META_KEY, JSON.stringify(copy));
    });
  }

  private _setLocalRaw(key: string, value: string): void {
    this._memCache.set(key, value);
    if (key === CLOUD_SYNC_META_KEY && !this._dirtyTrackingSuspended) {
      this._cloudMetaCache = null;
    }
    if (this._immediateSyncWindow) {
      this._dirtyStorage.delete(key);
      Platform.setStorageSync(key, value);
      return;
    }
    this._dirtyStorage.set(key, value);
    this._scheduleAsyncFlush();
  }

  private _removeLocalRaw(key: string): void {
    this._memCache.set(key, null);
    if (key === CLOUD_SYNC_META_KEY) {
      this._cloudMetaCache = null;
    }
    if (this._immediateSyncWindow) {
      this._dirtyStorage.delete(key);
      Platform.removeStorageSync(key);
      return;
    }
    this._dirtyStorage.set(key, null);
    this._scheduleAsyncFlush();
  }

  private _scheduleAsyncFlush(): void {
    if (this._flushTimer !== null) return;
    this._flushTimer = globalThis.setTimeout(() => {
      this._flushTimer = null;
      void this._flushDirtyAsync();
    }, ASYNC_FLUSH_DEBOUNCE_MS);
  }

  private async _flushDirtyAsync(): Promise<void> {
    if (this._dirtyStorage.size === 0) return;
    const entries = [...this._dirtyStorage.entries()];
    this._dirtyStorage.clear();

    for (const [key, val] of entries) {
      if (val === null) {
        await Platform.removeStorageAsync(key);
      } else {
        await Platform.setStorageAsync(key, val);
      }
    }
  }

  private _enterImmediateSyncTurn(): void {
    this._immediateSyncWindow = true;
    this.flushAllSync();
    if (this._immediateSyncResetTimer !== null) {
      clearTimeout(this._immediateSyncResetTimer);
    }
    this._immediateSyncResetTimer = globalThis.setTimeout(() => {
      this._immediateSyncResetTimer = null;
      this._immediateSyncWindow = false;
    }, 0);
  }

  private _bindLifecycleSafetyHooks(): void {
    if (this._hooksBound) return;
    if (typeof Platform === 'undefined' || !Platform || typeof Platform.registerEmergencyFlush !== 'function') {
      const defer = typeof queueMicrotask === 'function'
        ? queueMicrotask
        : (fn: () => void) => { globalThis.setTimeout(fn, 0); };
      defer(() => this._bindLifecycleSafetyHooks());
      return;
    }
    this._hooksBound = true;

    Platform.registerEmergencyFlush(() => {
      this.flushAllSync();
    });
    Platform.onHide(() => {
      this._enterImmediateSyncTurn();
    });
    Platform.onMemoryWarning(() => {
      this.flushAllSync();
    });
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      const onUnloadLike = () => {
        this._enterImmediateSyncTurn();
      };
      window.addEventListener('pagehide', onUnloadLike);
      window.addEventListener('beforeunload', onUnloadLike);
    }
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          this._enterImmediateSyncTurn();
        } else {
          this._immediateSyncWindow = false;
        }
      });
    }
  }
}

const _global: any = typeof GameGlobal !== 'undefined' ? GameGlobal : globalThis;
if (!_global.__persistService) {
  _global.__persistService = new PersistServiceClass();
}
export const PersistService: PersistServiceClass = _global.__persistService;

const _persistPerfProps = {
  flushAllSync(): void {
    PersistService.flushAllSync();
  },
  get pendingDirtyKeys(): number {
    return (PersistService as any)._dirtyStorage?.size ?? 0;
  },
};
const _perfTarget = _global.__jiancaiPerf || (_global.__jiancaiPerf = {});
Object.defineProperties(_perfTarget, Object.getOwnPropertyDescriptors(_persistPerfProps));
(globalThis as any).__jiancaiPerf = _perfTarget;
