import { Platform } from '@/core/PlatformService';

const BOOT_PACKAGES = ['images', 'kitchen'] as const;
const SUBPACKAGE_WAIT_MS = 20000;

const loaded = new Set<string>();
const inflight = new Map<string, Promise<void>>();

export function subpackageForPath(path: string): string | null {
  if (path.startsWith('subpkg_images/')) return 'images';
  if (path.startsWith('subpkg_kitchen/')) return 'kitchen';
  return null;
}

export function ensureSubpackage(name: string): Promise<void> {
  if (loaded.has(name)) return Promise.resolve();
  const hit = inflight.get(name);
  if (hit) return hit;
  const pending = loadOne(name).finally(() => inflight.delete(name));
  inflight.set(name, pending);
  return pending;
}

async function loadOne(name: string): Promise<void> {
  if (Platform.isDevtools) {
    loaded.add(name);
    return;
  }
  try {
    const result = await Promise.race([
      Platform.loadSubpackage(name),
      new Promise<'timeout'>((resolve) => {
        globalThis.setTimeout(() => resolve('timeout'), SUBPACKAGE_WAIT_MS);
      }),
    ]);
    if (result === 'timeout') {
      console.warn('[boot] loadSubpackage 超时，继续用磁盘路径', name);
      return;
    }
    loaded.add(name);
    console.log('[boot] 分包就绪', name, result);
  } catch (err) {
    console.warn('[boot] loadSubpackage 失败，继续用磁盘路径', name, err);
  }
}

/** Loading 出画后、预加载厨房图之前：images + kitchen 齐了再 createImage。 */
export function ensureBootSubpackages(
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  let done = 0;
  const total = BOOT_PACKAGES.length;
  return Promise.all(BOOT_PACKAGES.map(async (name) => {
    await ensureSubpackage(name);
    done += 1;
    onProgress?.(done, total);
  })).then(() => undefined);
}
