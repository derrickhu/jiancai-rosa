/**
 * CDN 上传配置加载。
 *
 * 优先级：
 *   1. 环境变量 CDN_CLOUD_BUCKET / TENCENTCLOUD_*
 *   2. scripts/.cdn_secret
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, '..');

function readEnvFile(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  for (const line of fs.readFileSync(filePath, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '').trim();
  }
  return out;
}

export function loadUploadEnv() {
  const secretFile = path.join(__dirname, '.cdn_secret');
  const merged = {
    ...readEnvFile(secretFile),
    ...process.env,
  };

  return {
    cloudBucket: merged.CDN_CLOUD_BUCKET || merged.HUAHUA_CDN_CLOUD_BUCKET || '',
    tencentAppId: merged.TENCENTCLOUD_APPID || '',
    tencentSecretId: merged.TENCENTCLOUD_SECRET_ID || '',
    tencentSecretKey: merged.TENCENTCLOUD_SECRET_KEY || '',
    tencentRegion: merged.TENCENTCLOUD_REGION || '',
    cdnBaseUrl: merged.CDN_BASE_URL || '',
  };
}
