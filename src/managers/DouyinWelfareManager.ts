/**
 * 侧边栏每日金币 + 添加桌面一次性金币。
 * 独立存储，不进云存档。微信端 init 直接返回。
 */
import { PersistService } from '@/core/PersistService';
import { Platform } from '@/core/PlatformService';
import { DOUYIN_WELFARE, DOUYIN_WELFARE_STORAGE_KEY } from '@/config/DouyinWelfareConfig';
import { DesktopEntry, SidebarEntry } from '@/platform/douyinEntry';
import { KitchenManager } from './KitchenManager';

interface DouyinWelfareState {
  sidebarRewardDate: string;
  desktopRewardClaimed: boolean;
}

function localDateKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

class DouyinWelfareManagerClass {
  private _state: DouyinWelfareState = {
    sidebarRewardDate: '',
    desktopRewardClaimed: false,
  };

  init(): void {
    if (!Platform.isDouyin) return;
    const raw = PersistService.readJSON<Partial<DouyinWelfareState>>(DOUYIN_WELFARE_STORAGE_KEY);
    this._state.sidebarRewardDate = typeof raw?.sidebarRewardDate === 'string' ? raw.sidebarRewardDate : '';
    this._state.desktopRewardClaimed = raw?.desktopRewardClaimed === true;
    DesktopEntry.refreshStatus();
  }

  /** 抖音包始终留入口，审核和真机都能点到侧边栏 / 桌面。 */
  get hasEntry(): boolean {
    return Platform.isDouyin;
  }

  get sidebarClaimedToday(): boolean {
    return this._state.sidebarRewardDate === localDateKey();
  }

  get desktopRewardClaimed(): boolean {
    return this._state.desktopRewardClaimed;
  }

  get hasRedDot(): boolean {
    if (!this.hasEntry) return false;
    if (SidebarEntry.isFromSidebar() && !this.sidebarClaimedToday) return true;
    if (!this._state.desktopRewardClaimed) return true;
    return false;
  }

  claimSidebarReward(): boolean {
    if (!Platform.isDouyin) return false;
    if (!SidebarEntry.isFromSidebar()) return false;
    if (this.sidebarClaimedToday) return false;
    KitchenManager.grantCoins(DOUYIN_WELFARE.sidebarCoins, `侧边栏奖励 +${DOUYIN_WELFARE.sidebarCoins}`);
    this._state.sidebarRewardDate = localDateKey();
    this._save();
    return true;
  }

  claimDesktopReward(): boolean {
    if (!Platform.isDouyin || this._state.desktopRewardClaimed) return false;
    KitchenManager.grantCoins(DOUYIN_WELFARE.desktopCoins, `桌面奖励 +${DOUYIN_WELFARE.desktopCoins}`);
    this._state.desktopRewardClaimed = true;
    this._save();
    return true;
  }

  private _save(): void {
    PersistService.writeJSON(DOUYIN_WELFARE_STORAGE_KEY, this._state);
  }
}

export const DouyinWelfareManager = new DouyinWelfareManagerClass();
