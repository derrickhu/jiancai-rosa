import { Platform } from './PlatformService';

class PersistServiceClass {
  readRaw(key: string): string | null {
    if (Platform.isMinigame) return Platform.getStorageSync(key);
    if (typeof localStorage === 'undefined') return null;
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }

  readJSON<T>(key: string): T | null {
    const raw = this.readRaw(key);
    if (!raw) return null;
    try { return JSON.parse(raw) as T; } catch (e) {
      console.warn(`[Persist] JSON 读取失败 key=${key}:`, e);
      return null;
    }
  }

  writeRaw(key: string, value: string): void {
    if (Platform.isMinigame) {
      Platform.setStorageSync(key, value);
      return;
    }
    try { localStorage.setItem(key, value); } catch (_) {}
  }

  writeJSON(key: string, value: unknown): void {
    this.writeRaw(key, JSON.stringify(value));
  }
}

export const PersistService = new PersistServiceClass();
