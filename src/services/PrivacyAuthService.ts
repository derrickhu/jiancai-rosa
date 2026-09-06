export type PrivacyAuthStatus = 'agreed' | 'disagreed' | 'unsupported';

export interface PrivacyAuthResult {
  status: PrivacyAuthStatus;
  errMsg?: string;
}

class PrivacyAuthServiceClass {
  private sessionAgreed = false;

  reset(): void {
    this.sessionAgreed = false;
  }

  request(): Promise<PrivacyAuthResult> {
    if (this.sessionAgreed) {
      return Promise.resolve({ status: 'agreed' });
    }
    const api = typeof wx !== 'undefined' ? wx : null;
    if (!api) {
      return Promise.resolve({ status: 'unsupported' });
    }
    if (typeof api.getPrivacySetting === 'function') {
      return new Promise((resolve) => {
        api.getPrivacySetting({
          success: (res: { needAuthorization?: boolean }) => {
            if (!res?.needAuthorization) {
              this.sessionAgreed = true;
              resolve({ status: 'agreed' });
              return;
            }
            this.requirePrivacyAuthorize(resolve);
          },
          fail: (err: { errMsg?: string }) => {
            console.warn('[PrivacyAuth] getPrivacySetting fail', err?.errMsg);
            this.requirePrivacyAuthorize(resolve);
          },
        });
      });
    }
    if (typeof api.requirePrivacyAuthorize === 'function') {
      return new Promise((resolve) => this.requirePrivacyAuthorize(resolve));
    }
    return Promise.resolve({ status: 'unsupported' });
  }

  private requirePrivacyAuthorize(resolve: (r: PrivacyAuthResult) => void): void {
    const api = typeof wx !== 'undefined' ? wx : null;
    if (!api?.requirePrivacyAuthorize) {
      resolve({ status: 'unsupported' });
      return;
    }
    try {
      api.requirePrivacyAuthorize({
        success: () => {
          this.sessionAgreed = true;
          resolve({ status: 'agreed' });
        },
        fail: (err: { errMsg?: string }) => {
          resolve({ status: 'disagreed', errMsg: err?.errMsg });
        },
      });
    } catch (error) {
      console.warn('[PrivacyAuth] requirePrivacyAuthorize threw', error);
      resolve({ status: 'unsupported' });
    }
  }
}

export const PrivacyAuthService = new PrivacyAuthServiceClass();
