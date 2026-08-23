import { CDN_CONFIG, type CdnConfig } from '@/config/CdnConfig';
import { Platform } from './PlatformService';

export interface CdnManifestFile {
  hash?: string;
  size?: number;
}

export interface CdnManifest {
  version?: number;
  updated?: string;
  files: Record<string, CdnManifestFile>;
}

type ProgressCallback = (loaded: number, total: number) => void;

class CdnAssetServiceClass {
  private readonly _config: CdnConfig = CDN_CONFIG;
  private readonly _cdnDirPrefixes = this._config.cdnDirs.map(d => this._prefix(d));
  private readonly _bundledPrefixes = this._config.bundledDirs.map(d => this._prefix(d));
  private _manifest: CdnManifest | null = null;
  private _manifestReady = false;
  private _downloadQueue = new Map<string, Promise<boolean>>();
  private _localExistsCache = new Map<string, boolean>();
  private _accessLog = new Map<string, number>();
  private _accessFrame = 0;

  get enabled(): boolean {
    return this._config.enabled;
  }

  get manifestReady(): boolean {
    return this._manifestReady;
  }

  get manifest(): CdnManifest | null {
    return this._manifest;
  }

  isCdnPath(path: string): boolean {
    const normalized = this._normalize(path);
    if (!this.enabled || this.isBundledPath(normalized)) return false;
    if (this._config.cdnPrefixes.length > 0) {
      return this._config.cdnPrefixes.some(prefix => this._matchPrefix(normalized, prefix));
    }
    return this._cdnDirPrefixes.some(prefix => normalized.startsWith(prefix));
  }

  isBundledPath(path: string): boolean {
    const normalized = this._normalize(path);
    return this._bundledPrefixes.some(prefix => normalized.startsWith(prefix));
  }

  areAllCdnPaths(paths: readonly string[]): boolean {
    return paths.length > 0 && paths.every(path => this.isCdnPath(path));
  }

  resolveAsset(path: string): string | null {
    const logicalPath = this._normalize(path);
    if (!this.isCdnPath(logicalPath)) return logicalPath;

    this._touch(logicalPath);
    if (this._isCacheValid(logicalPath)) return this._getCachePath(logicalPath);
    return null;
  }

  async resolveOrDownload(path: string): Promise<string> {
    const logicalPath = this._normalize(path);
    const resolved = this.resolveAsset(logicalPath);
    if (resolved) return resolved;

    if (!this.isCdnPath(logicalPath)) {
      return logicalPath;
    }

    const ok = await this.download(logicalPath);
    if (ok && this._isCacheValid(logicalPath)) return this._getCachePath(logicalPath);

    console.warn(`[CDN] 资源未从云端就绪，使用本地分包路径: ${logicalPath}`);
    return logicalPath;
  }

  async fetchManifest(): Promise<boolean> {
    if (!this.enabled) {
      this._manifest = { files: {} };
      this._manifestReady = true;
      return false;
    }

    const fs = this._getFs();
    if (!fs || !this._config.baseUrl) {
      this._loadCachedManifest();
      return false;
    }

    /** 不要走 wx.downloadFile 拉 manifest.json。
     *  开发者工具/基础库对 CloudBase 默认域名 (*.tcb.qcloud.la) 上的 application/json
     *  会触发云开发协议层 JSON.parse，普通静态 JSON 会被报成
     *  "downloadFile:fail Unexpected end of JSON input"。
     *  改走 wx.request 直接拿文本。 */
    const url = `${this._getCdnUrl('manifest.json')}?_t=${Date.now()}`;
    try {
      const text = await this._requestText(url);
      if (!text) {
        this._loadCachedManifest();
        return false;
      }

      this._manifest = JSON.parse(text) as CdnManifest;
      this._manifestReady = true;
      this._ensureCacheDir(this._getCachePath('manifest.json'));
      try { fs.writeFileSync(this._getCachePath('manifest.json'), text, 'utf-8'); } catch (_) {}
      return true;
    } catch (e) {
      console.warn('[CDN] manifest 拉取失败，使用本地缓存:', e);
      this._loadCachedManifest();
      return false;
    }
  }

  async download(path: string): Promise<boolean> {
    const logicalPath = this._normalize(path);
    if (!this.isCdnPath(logicalPath)) return true;
    if (this._isCacheValid(logicalPath)) return true;

    const inflight = this._downloadQueue.get(logicalPath);
    if (inflight) return inflight;

    const task = this._downloadWithRetry(logicalPath).finally(() => {
      this._downloadQueue.delete(logicalPath);
    });
    this._downloadQueue.set(logicalPath, task);
    return task;
  }

  async preloadPaths(paths: readonly string[], onProgress?: ProgressCallback): Promise<void> {
    const cdnPaths = paths
      .map(p => this._normalize(p))
      .filter(p => this.isCdnPath(p) && !this._isCacheValid(p));

    if (cdnPaths.length === 0) {
      onProgress?.(paths.length, paths.length);
      return;
    }

    let done = 0;
    await Promise.race([
      Promise.all(cdnPaths.map(async (p) => {
        await this.download(p);
        done++;
        onProgress?.(paths.length - cdnPaths.length + done, paths.length);
      })),
      new Promise<void>(resolve => setTimeout(resolve, this._config.downloadTimeoutMs)),
    ]);
  }

  clearCache(): void {
    const fs = this._getFs();
    if (!fs || this._accessLog.size === 0) return;

    const entries = [...this._accessLog.entries()].sort((a, b) => a[1] - b[1]);
    const evictCount = Math.ceil(entries.length * 0.2);
    for (let i = 0; i < evictCount; i++) {
      const logicalPath = entries[i][0];
      const cachePath = this._getCachePath(logicalPath);
      try { fs.unlinkSync(cachePath); } catch (_) {}
      try { fs.unlinkSync(`${cachePath}.meta`); } catch (_) {}
      this._localExistsCache.delete(cachePath);
      this._accessLog.delete(logicalPath);
    }
  }

  clearAllCache(): void {
    const fs = this._getFs();
    const root = this._getCacheRootPath();
    if (!fs || !root) return;
    this._localExistsCache.clear();
    this._accessLog.clear();
    try {
      fs.rmdirSync(root, true);
      console.log('[CDN] 已清空本地 CDN 缓存');
    } catch (e) {
      console.warn('[CDN] 清空本地 CDN 缓存失败:', e);
    }
  }

  private async _downloadWithRetry(logicalPath: string): Promise<boolean> {
    const fs = this._getFs();
    if (!fs || !this._config.baseUrl) return false;
    const cachePath = this._getCachePath(logicalPath);
    this._ensureCacheDir(cachePath);

    for (let attempt = 0; attempt <= this._config.downloadRetry; attempt++) {
      try {
        const res = await this._downloadUrl(this._getCdnUrl(logicalPath));
        if (!res.tempFilePath) throw new Error('downloadFile missing tempFilePath');

        fs.copyFileSync(res.tempFilePath, cachePath);
        this._localExistsCache.set(cachePath, true);
        const hash = this._manifest?.files?.[logicalPath]?.hash || '';
        try { fs.writeFileSync(`${cachePath}.meta`, hash, 'utf-8'); } catch (_) {}
        return true;
      } catch (e) {
        if (attempt >= this._config.downloadRetry) {
          console.warn(`[CDN] 下载失败 ${logicalPath}:`, e);
          return false;
        }
        await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
    return false;
  }

  private _requestText(url: string): Promise<string> {
    return Platform.requestText(url, this._config.downloadTimeoutMs)
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[CDN] request fail: ${url}, ${msg}`);
        throw err instanceof Error ? err : new Error(msg);
      });
  }

  private _downloadUrl(url: string): Promise<{ tempFilePath?: string }> {
    return Platform.downloadFile({ url })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[CDN] downloadFile fail: ${url}, ${msg}`);
        throw err instanceof Error ? err : new Error(msg);
      });
  }

  private _loadCachedManifest(): void {
    const fs = this._getFs();
    try {
      const text = fs?.readFileSync(this._getCachePath('manifest.json'), 'utf-8');
      this._manifest = text ? JSON.parse(text) as CdnManifest : { files: {} };
    } catch (_) {
      this._manifest = { files: {} };
    }
    this._manifestReady = true;
  }

  private _isCacheValid(logicalPath: string): boolean {
    if (!this._cacheFileExists(logicalPath)) return false;
    const entry = this._manifest?.files?.[logicalPath];
    if (entry?.size && this._getLocalFileSize(this._getCachePath(logicalPath)) !== entry.size) {
      return false;
    }
    if (!entry?.hash) return true;
    return this._readCachedHash(logicalPath) === entry.hash;
  }

  private _cacheFileExists(logicalPath: string): boolean {
    return this._localFileExists(this._getCachePath(logicalPath));
  }

  private _localFileExists(path: string): boolean {
    const cached = this._localExistsCache.get(path);
    if (cached !== undefined) return cached;

    const fs = this._getFs();
    if (!fs) {
      this._localExistsCache.set(path, false);
      return false;
    }

    try {
      fs.accessSync(path);
      this._localExistsCache.set(path, true);
      return true;
    } catch (_) {
      this._localExistsCache.set(path, false);
      return false;
    }
  }

  private _getLocalFileSize(path: string): number {
    const fs = this._getFs();
    try {
      const stat = fs?.statSync(path);
      return Number(stat?.size || 0);
    } catch (_) {
      return 0;
    }
  }

  private _readCachedHash(logicalPath: string): string | null {
    const fs = this._getFs();
    try {
      return String(fs?.readFileSync(`${this._getCachePath(logicalPath)}.meta`, 'utf-8') || '').trim();
    } catch (_) {
      return null;
    }
  }

  private _getCdnUrl(logicalPath: string): string {
    const base = this._config.baseUrl.replace(/\/+$/, '');
    return `${base}/${this._config.filePrefix}/${logicalPath}`;
  }

  private _getCachePath(logicalPath: string): string {
    return `${this._getCacheRootPath()}/${logicalPath}`;
  }

  private _getCacheRootPath(): string {
    const userDataPath = this._getUserDataPath();
    return userDataPath ? `${userDataPath}/${this._config.cacheRootName}` : '';
  }

  private _ensureCacheDir(filePath: string): void {
    const fs = this._getFs();
    const userDataPath = this._getUserDataPath();
    if (!fs || !userDataPath) return;

    const dir = filePath.split('/').slice(0, -1).join('/');
    try { fs.accessSync(dir); return; } catch (_) {}

    const segments = dir.replace(`${userDataPath}/`, '').split('/').filter(Boolean);
    let cur = userDataPath;
    for (const seg of segments) {
      cur += `/${seg}`;
      try { fs.accessSync(cur); } catch (_) {
        try { fs.mkdirSync(cur, true); } catch (_) {}
      }
    }
  }

  private _getFs(): any {
    return Platform.getFileSystemManager();
  }

  private _getUserDataPath(): string {
    return Platform.userDataPath;
  }

  private _touch(logicalPath: string): void {
    this._accessFrame++;
    this._accessLog.set(logicalPath, this._accessFrame);
  }

  private _matchPrefix(path: string, prefix: string): boolean {
    return path === prefix || path.startsWith(prefix);
  }

  private _prefix(path: string): string {
    const normalized = this._normalize(path);
    return normalized.endsWith('/') ? normalized : `${normalized}/`;
  }

  private _normalize(path: string): string {
    return path.replace(/^\/+/, '').replace(/^minigame\//, '');
  }
}

export const CdnAssetService = new CdnAssetServiceClass();
