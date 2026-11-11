/**
 * 抖音侧边栏复访、添加到桌面。
 * 启动参数由 minigame/game.js 在 bundle 之前写入 GameGlobal。
 * 审核要看到 tt.navigateToScene / tt.addShortcut 这两个点号调用，并且留在点击同步栈里。
 */
import { Platform } from '@/core/PlatformService';

declare const tt: any;

interface DouyinGameGlobal {
  __launchInfo?: DouyinLaunchInfo;
  __sidebarSupported?: boolean;
  __desktopShortcutSupported?: boolean;
  __desktopShortcutStatus?: { exist?: boolean; needUpdate?: boolean } | null;
}

export interface DouyinLaunchInfo {
  scene?: string | number;
  launch_from?: string;
  location?: string;
  query?: { launch_from?: string; location?: string };
}

function readGameGlobal(): DouyinGameGlobal | undefined {
  if (typeof GameGlobal === 'undefined') return undefined;
  return GameGlobal as DouyinGameGlobal;
}

export function isFromDouyinSidebar(info: DouyinLaunchInfo | undefined): boolean {
  if (!info) return false;
  const from = info.launch_from || info.query?.launch_from;
  const location = info.location || info.query?.location;
  return String(info.scene ?? '') === '021036'
    && from === 'homepage'
    && location === 'sidebar_card';
}

class SidebarEntryService {
  get supported(): boolean {
    return !!readGameGlobal()?.__sidebarSupported;
  }

  get launchInfo(): DouyinLaunchInfo {
    return readGameGlobal()?.__launchInfo ?? {};
  }

  get available(): boolean {
    return Platform.isDouyin && this.supported;
  }

  isFromSidebar(): boolean {
    return isFromDouyinSidebar(this.launchInfo);
  }

  navigate(handlers?: { onFail?: () => void }): void {
    const opts = {
      scene: 'sidebar',
      fail: () => handlers?.onFail?.(),
    };
    if (typeof tt !== 'undefined' && typeof tt.navigateToScene === 'function') {
      tt.navigateToScene(opts);
      return;
    }
    Platform.navigateToScene(opts);
  }
}

class DesktopEntryService {
  get supported(): boolean {
    return !!readGameGlobal()?.__desktopShortcutSupported;
  }

  get available(): boolean {
    return Platform.isDouyin && this.supported;
  }

  get alreadyAdded(): boolean {
    return readGameGlobal()?.__desktopShortcutStatus?.exist === true;
  }

  refreshStatus(): void {
    Platform.checkShortcut({
      success: (res) => {
        const global = readGameGlobal();
        if (global) global.__desktopShortcutStatus = res?.status ?? null;
      },
    });
  }

  /** 必须留在点击回调的同步栈里。返回 false 表示宿主没有这个接口。 */
  add(handlers?: { onSuccess?: () => void; onFail?: () => void }): boolean {
    if (!this.supported && typeof tt === 'undefined') return false;
    const opts = {
      success: () => {
        this.refreshStatus();
        handlers?.onSuccess?.();
      },
      fail: () => handlers?.onFail?.(),
    };
    if (typeof tt !== 'undefined' && typeof tt.addShortcut === 'function') {
      tt.addShortcut(opts);
      return true;
    }
    if (typeof Platform.api?.addShortcut !== 'function') return false;
    Platform.addShortcut(opts);
    return true;
  }
}

export const SidebarEntry = new SidebarEntryService();
export const DesktopEntry = new DesktopEntryService();
