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
  /** 已通过尺寸与 hash 完整校验的缓存路径（logicalPath -> cachePath），命中后 0ms 零 fs 跨桥开销。 */
  private _validatedCache = new Map<string, string>();
  /** 已校验文件大小 >= 64B 的物理路径集合，避免每次播音效同步调 fs.statSync。 */
  private _readyFileCache = new Set<string>();
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
    return this._matchesCdnPrefix(normalized);
  }

  isBundledPath(path: string): boolean {
    const normalized = this._normalize(path);
    if (this._matchesCdnPrefix(normalized)) return false;
    return this._bundledPrefixes.some(prefix => normalized.startsWith(prefix));
  }

  areAllCdnPaths(paths: readonly string[]): boolean {
    return paths.length > 0 && paths.every(path => this.isCdnPath(path));
  }

  resolveAsset(path: string): string | null {
    const logicalPath = this._normalize(path);
    if (!this.isCdnPath(logicalPath)) return logicalPath;

    this._touch(logicalPath);
    const hit = this._validatedCache.get(logicalPath);
    if (hit !== undefined) return hit;
    if (this._isCacheValid(logicalPath)) {
      return this._validatedCache.get(logicalPath) || this._getCachePath(logicalPath);
    }
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
    if (ok && this._isCacheValid(logicalPath)) {
      return this._validatedCache.get(logicalPath) || this._getCachePath(logicalPath);
    }

    // CDN 专属资源不在微信包里。再回落相对路径只会让图片/音效二次失败。
    if (this._config.baseUrl) {
      console.warn(`[CDN] 本地缓存未就绪，直连云端: ${logicalPath}`);
      return this._getCdnUrl(logicalPath);
    }

    console.warn(`[CDN] 资源未从云端就绪，使用本地分包路径: ${logicalPath}`);
    return logicalPath;
  }

  /** 开发者工具 USER_DATA_PATH 是 http://usr，图片能读，InnerAudio 必须 wxfile://。 */
  toInnerAudioSrc(path: string): string {
    // wxfile 只存在于微信。抖音缓存是 ttfile://user，改写成 wxfile 会把音效播空。
    if (!Platform.isWechat) return path;
    if (/^https?:\/\/usr\//.test(path)) return path.replace(/^https?:\/\/usr\//, 'wxfile://usr/');
    return path;
  }

  publicUrl(path: string): string {
    return this._getCdnUrl(this._normalize(path));
  }

  /**
   * 给 InnerAudio。对齐花花：播 resolveOrDownload 拿到的那条路径。
   * 真机 USER_DATA_PATH 已是 wxfile://usr。
   * 开发者工具是 http://usr，文件也写在这儿；不要改成 wxfile://usr，
   * Mac 3.17 两套路径不是同一份，改了就是 readFile no such file。
   * 只有 wxfile 那边真有文件时才用 wxfile。
   */
  async resolveAudioSrc(path: string): Promise<string> {
    const resolved = await this.resolveOrDownload(path);
    if (/^https?:\/\//.test(resolved) && !/^https?:\/\/usr\//.test(resolved)) return resolved;
    if (this._fileReady(resolved)) return resolved;
    const alt = this.toInnerAudioSrc(resolved);
    if (alt !== resolved && this._fileReady(alt)) return alt;
    return resolved;
  }

  invalidateCache(path: string): void {
    const logicalPath = this._normalize(path);
    const cachePath = this._getCachePath(logicalPath);
    this._evictCachedValidation(logicalPath, cachePath);
    this._localExistsCache.delete(cachePath);
    const fs = this._getFs();
    try { fs?.unlinkSync(cachePath); } catch (_) {}
    try { fs?.unlinkSync(`${cachePath}.meta`); } catch (_) {}
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
      // 新 manifest 到位后重置校验记忆，让后续首次访问按最新 hash/size 核验一次后再常驻命中
      this._validatedCache.clear();
      this._readyFileCache.clear();
      this._ensureCacheDir(this._getCachePath('manifest.json'));
      try { fs.writeFileSync(this._getCachePath('manifest.json'), text, 'utf-8'); } catch (_) {}
      setTimeout(() => this._pruneOrphanedCache(fs), 3000);
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
    let cursor = 0;
    const limit = 4;
    const workers = Array.from({ length: Math.min(limit, cdnPaths.length) }, async () => {
      while (cursor < cdnPaths.length) {
        const p = cdnPaths[cursor];
        cursor += 1;
        await this.download(p);
        done += 1;
        onProgress?.(paths.length - cdnPaths.length + done, paths.length);
      }
    });
    await Promise.race([
      Promise.all(workers),
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
      this._evictCachedValidation(logicalPath, cachePath);
      this._localExistsCache.delete(cachePath);
      this._accessLog.delete(logicalPath);
    }
  }

  clearAllCache(): void {
    const fs = this._getFs();
    const root = this._getCacheRootPath();
    if (!fs || !root) return;
    this._localExistsCache.clear();
    this._validatedCache.clear();
    this._readyFileCache.clear();
    this._accessLog.clear();
    try {
      fs.rmdirSync(root, true);
      console.log('[CDN] 已清空本地 CDN 缓存');
    } catch (e) {
      console.warn('[CDN] 清空本地 CDN 缓存失败:', e);
    }
  }

  private _evictCachedValidation(logicalPath: string, cachePath: string): void {
    this._validatedCache.delete(logicalPath);
    this._readyFileCache.delete(cachePath);
    const alt = this.toInnerAudioSrc(cachePath);
    if (alt !== cachePath) this._readyFileCache.delete(alt);
  }

  /** 遍历本地 CDN 缓存目录（排除 manifest.json），返回逻辑路径列表。 */
  private _scanCachedFiles(fs: any): string[] {
    const root = this._getCacheRootPath();
    if (!fs || !root || typeof fs.readdirSync !== 'function') return [];
    const results: string[] = [];
    const walk = (dir: string, relPrefix: string): void => {
      let names: string[];
      try {
        names = fs.readdirSync(dir) || [];
      } catch (_) {
        return;
      }
      for (const name of names) {
        if (!name || name === 'manifest.json' || name.endsWith('.meta')) continue;
        const full = `${dir}/${name}`;
        const rel = relPrefix ? `${relPrefix}/${name}` : name;
        try {
          const st = fs.statSync?.(full);
          if (st?.isDirectory?.()) {
            walk(full, rel);
          } else {
            results.push(rel);
          }
        } catch (_) {
          // 某些基础库 statSync 异常时按扩展名兜底判断目录
          if (!name.includes('.')) walk(full, rel);
          else results.push(rel);
        }
      }
    };
    walk(root, '');
    return results;
  }

  private _unlinkLogicalFile(fs: any, logicalPath: string): void {
    const cachePath = this._getCachePath(logicalPath);
    try { fs.unlinkSync(cachePath); } catch (_) {}
    try { fs.unlinkSync(`${cachePath}.meta`); } catch (_) {}
    this._evictCachedValidation(logicalPath, cachePath);
    this._localExistsCache.delete(cachePath);
    this._accessLog.delete(logicalPath);
  }

  /** 清理已不在最新 manifest 中的历史废弃文件（v1~v45 遗留旧资源）。 */
  private _pruneOrphanedCache(fs: any): number {
    const manifestFiles = this._manifest?.files;
    if (!fs || !manifestFiles || Object.keys(manifestFiles).length === 0) return 0;
    let removed = 0;
    for (const rel of this._scanCachedFiles(fs)) {
      if (!(rel in manifestFiles)) {
        this._unlinkLogicalFile(fs, rel);
        removed += 1;
      }
    }
    return removed;
  }

  /** USER_DATA_PATH 触达上限时自动淘汰孤儿文件与最久未用缓存，腾出空间后重试落盘。 */
  private _evictDiskFilesForSpace(fs: any, keepLogicalPath: string): void {
    const pruned = this._pruneOrphanedCache(fs);
    if (this._accessLog.size > 0) {
      this.clearCache();
      return;
    }
    const diskFiles = this._scanCachedFiles(fs).filter(p => p !== keepLogicalPath);
    if (diskFiles.length === 0) return;
    // 优先淘汰非必需大图，保留少量样本；若之前已删孤儿仍不够再清 25% 磁盘缓存
    const targetCount = Math.max(pruned > 0 ? 8 : 16, Math.ceil(diskFiles.length * 0.25));
    for (let i = 0; i < Math.min(targetCount, diskFiles.length); i++) {
      this._unlinkLogicalFile(fs, diskFiles[i]);
    }
  }

  private async _downloadWithRetry(logicalPath: string): Promise<boolean> {
    const fs = this._getFs();
    if (!fs || !this._config.baseUrl) return false;
    const cachePath = this._getCachePath(logicalPath);
    this._evictCachedValidation(logicalPath, cachePath);
    this._ensureCacheDir(cachePath);

    for (let attempt = 0; attempt <= this._config.downloadRetry; attempt++) {
      try {
        const res = await this._downloadUrl(this._getCdnUrl(logicalPath));
        if (!res.tempFilePath) throw new Error('downloadFile missing tempFilePath');

        try {
          fs.copyFileSync(res.tempFilePath, cachePath);
        } catch (copyErr) {
          const copyMsg = copyErr instanceof Error ? copyErr.message : String(copyErr);
          if (/maximum size|storage limit|exceeded|no space/i.test(copyMsg)) {
            this._evictDiskFilesForSpace(fs, logicalPath);
            this._ensureCacheDir(cachePath);
            fs.copyFileSync(res.tempFilePath, cachePath);
          } else {
            throw copyErr;
          }
        }
        const size = this._getLocalFileSize(cachePath);
        const expected = this._manifest?.files?.[logicalPath]?.size;
        if (size < 64 || (typeof expected === 'number' && expected > 0 && size !== expected)) {
          this._localExistsCache.set(cachePath, false);
          this._evictCachedValidation(logicalPath, cachePath);
          try { fs.unlinkSync(cachePath); } catch (_) {}
          try { fs.unlinkSync(`${cachePath}.meta`); } catch (_) {}
          throw new Error(`bad size ${size} expected ${expected || '>=64'}`);
        }
        this._localExistsCache.set(cachePath, true);
        const hash = this._manifest?.files?.[logicalPath]?.hash || '';
        try { fs.writeFileSync(`${cachePath}.meta`, hash, 'utf-8'); } catch (_) {}
        this._validatedCache.set(logicalPath, cachePath);
        this._readyFileCache.add(cachePath);
        return true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('status=404') || attempt >= this._config.downloadRetry) {
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
    if (this._validatedCache.has(logicalPath)) return true;

    const cachePath = this._getCachePath(logicalPath);
    if (!this._localFileExists(cachePath)) return false;
    const localSize = this._getLocalFileSize(cachePath);
    if (localSize < 64) return false;
    const entry = this._manifest?.files?.[logicalPath];
    if (entry?.size && localSize !== entry.size) {
      return false;
    }
    if (entry?.hash && this._readCachedHash(logicalPath) !== entry.hash) {
      return false;
    }
    this._validatedCache.set(logicalPath, cachePath);
    this._readyFileCache.add(cachePath);
    return true;
  }

  private _fileReady(path: string): boolean {
    if (!path) return false;
    if (this._readyFileCache.has(path)) return true;
    if (this._getLocalFileSize(path) >= 64) {
      this._readyFileCache.add(path);
      return true;
    }
    return false;
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

  private _matchesCdnPrefix(path: string): boolean {
    if (this._config.cdnPrefixes.length > 0) {
      return this._config.cdnPrefixes.some(prefix => this._matchPrefix(path, prefix));
    }
    return this._cdnDirPrefixes.some(prefix => path.startsWith(prefix));
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
