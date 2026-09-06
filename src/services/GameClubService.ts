import { BackendError, BackendService } from '@/core/BackendService';
import { Platform } from '@/core/PlatformService';
import { PrivacyAuthService } from './PrivacyAuthService';

export interface GameClubDailyPostStatus {
  postCount: number;
  supported: boolean;
  error?: string;
}

const DAILY_POST_DATA_TYPE = 6;
const GAME_CLUB_PRIVACY_ERROR = '需在微信后台隐私协议声明游戏社区数据';

function wxApi(): any {
  return Platform.api ?? (typeof wx !== 'undefined' ? wx : null);
}

export function isGameClubDataSupported(): boolean {
  return typeof wxApi()?.getGameClubData === 'function';
}

export function isGameClubButtonSupported(): boolean {
  return typeof wxApi()?.createGameClubButton === 'function';
}

export async function fetchDailyPostCount(): Promise<GameClubDailyPostStatus> {
  const api = wxApi();
  if (!api?.getGameClubData) {
    return { postCount: 0, supported: false, error: '当前环境不支持游戏圈数据' };
  }
  if (!BackendService.available) {
    return { postCount: 0, supported: false, error: '需登录后才能校验发帖任务' };
  }

  const privacy = await PrivacyAuthService.request();
  if (privacy.status === 'disagreed') {
    return { postCount: 0, supported: false, error: getPrivacyErrorMessage(privacy.errMsg) };
  }

  try {
    await BackendService.ensureToken();
  } catch (error) {
    console.warn('[GameClubService] ensure backend token failed', error);
    return {
      postCount: 0,
      supported: false,
      error: '登录失败，暂时无法同步任务进度',
    };
  }

  return new Promise((resolve) => {
    api.getGameClubData({
      dataTypeList: [{ type: DAILY_POST_DATA_TYPE }],
      success: (res: { encryptedData?: string; iv?: string }) => {
        void (async () => {
          try {
            const decrypted = await decryptGameClubDataWithSessionRetry({
              encryptedData: String(res.encryptedData || ''),
              iv: String(res.iv || ''),
            });
            const item = (decrypted.dataList || []).find(
              (entry) => getDataTypeValue(entry.dataType) === DAILY_POST_DATA_TYPE,
            );
            resolve({
              postCount: normalizeCount(item?.value),
              supported: true,
            });
          } catch (error) {
            console.warn('[GameClubService] decrypt daily post count failed', error);
            resolve({
              postCount: 0,
              supported: true,
              error: error instanceof Error ? error.message : '读取游戏圈数据失败',
            });
          }
        })();
      },
      fail: (error: { errMsg?: string; errno?: number; errNo?: number; err_code?: number }) => {
        console.warn('[GameClubService] getGameClubData failed', error);
        resolve({
          postCount: 0,
          supported: true,
          error: getPrivacyErrorMessage(error?.errMsg, error?.errno ?? error?.errNo ?? error?.err_code),
        });
      },
    });
  });
}

function normalizeCount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function getDataTypeValue(dataType: number | { type?: number }): number {
  if (typeof dataType === 'number') return dataType;
  return Number(dataType?.type || 0);
}

async function decryptGameClubDataWithSessionRetry(payload: { encryptedData: string; iv: string }) {
  try {
    return await BackendService.decryptGameClubData(payload);
  } catch (error) {
    if (error instanceof BackendError && shouldRefreshWxSession(error.code)) {
      BackendService.clearToken();
      await BackendService.ensureToken();
      return BackendService.decryptGameClubData(payload);
    }
    throw error;
  }
}

function shouldRefreshWxSession(code: string): boolean {
  return code === 'DECRYPT_FAIL' || code === 'NO_WX_SESSION' || code === 'BAD_GAME_CLUB_PAYLOAD';
}

function getPrivacyErrorMessage(errMsg?: string, errCode?: number): string {
  if (errCode === 112 || errMsg?.includes('privacy agreement') || errMsg?.includes('privacy api permission')) {
    return GAME_CLUB_PRIVACY_ERROR;
  }
  if (errMsg?.includes('deny') || errMsg?.includes('disagree')) {
    return '需同意隐私协议后校验发帖任务';
  }
  return '获取游戏圈数据失败，请稍后重试';
}
