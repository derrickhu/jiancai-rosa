/**
 * @pixi/unsafe-eval 内联 patch + PIXI.settings.ADAPTER 配置 + 有界 2D Canvas 对象池
 * 必须在 new PIXI.Application() 之前执行
 * 单独文件，避免 Game.ts 因副作用代码被 bundler 打包多份
 */
import { ShaderSystem, BaseImageResource, Texture, BaseTexture } from '@pixi/core';
import { settings } from '@pixi/settings';
import { Text } from '@pixi/text';
import { getNativePlatformApi } from './platformDetect';

export interface CanvasPoolStats {
  totalCreated: number;
  totalRequests: number;
  reuseRate: number;
  pooled: number;
  activeOut: number;
}

interface CanvasPoolState {
  pool: any[];
  pooledSet: Set<any>;
  totalCreated: number;
  totalRequests: number;
  activeOut: number;
  adapterPatched: boolean;
}

const MAX_CANVAS_POOL = 160;

const _holder: any = typeof GameGlobal !== 'undefined' ? GameGlobal
  : typeof window !== 'undefined' ? window
  : globalThis;

const _poolState: CanvasPoolState = _holder.__jiancaiCanvasPoolState ?? (
  _holder.__jiancaiCanvasPoolState = {
    pool: [],
    pooledSet: new Set<any>(),
    totalCreated: 0,
    totalRequests: 0,
    activeOut: 0,
    adapterPatched: false,
  }
);

/**
 * 回收 PIXI.Text 等独占的 2D 离屏 Canvas：
 * 1) 立即缩回 1×1 释放底层 Metal/Skia IOSurface 数 MB 原生像素缓冲；
 * 2) 清理旧 _pixiId，避免复用时命中已销毁纹理缓存 ID；
 * 3) 有界入池复用（上限 64），超出上限则置 0×0 彻底释放。
 */
export function recycle2DCanvas(canvas: any): void {
  if (!canvas || _poolState.pooledSet.has(canvas)) return;

  try {
    delete canvas._pixiId;
  } catch (_) {
    canvas._pixiId = undefined;
  }

  _poolState.activeOut = Math.max(0, _poolState.activeOut - 1);

  if (_poolState.pool.length < MAX_CANVAS_POOL) {
    try {
      canvas.width = 1;
      canvas.height = 1;
    } catch (_) { /* ignore */ }
    _poolState.pooledSet.add(canvas);
    _poolState.pool.push(canvas);
  } else {
    try {
      canvas.width = 0;
      canvas.height = 0;
    } catch (_) {
      try {
        canvas.width = 1;
        canvas.height = 1;
      } catch (_2) { /* ignore */ }
    }
  }
}

export function getCanvasPoolStats(): CanvasPoolStats {
  const totalRequests = _poolState.totalRequests || 0;
  const totalCreated = _poolState.totalCreated;
  const reuseRate = totalRequests > 0
    ? Math.max(0, Math.round(((totalRequests - totalCreated) / totalRequests) * 10000) / 10000)
    : 1;
  return {
    totalCreated,
    totalRequests,
    reuseRate,
    pooled: _poolState.pool.length,
    activeOut: _poolState.activeOut,
  };
}

_holder.__jiancaiCanvasStats = getCanvasPoolStats;
(globalThis as any).__jiancaiCanvasStats = getCanvasPoolStats;

// Game.stage 已按物理像素缩放（750 设计宽本身已是 2x 高清密度），锁死 Text 默认分辨率为 1，杜绝叠加 DPR 生成 9 倍巨型文字贴图
Text.defaultResolution = 1;
Text.defaultAutoResolution = false;

// ======== 配置 PIXI.settings.ADAPTER + 2D Canvas 池化 ========
const _api: any = getNativePlatformApi();
settings.CREATE_IMAGE_BITMAP = false;

if (!_poolState.adapterPatched) {
  _poolState.adapterPatched = true;

  if (_api) {
    try {
      // 优先 createOffscreenCanvas({ type:'2d' }) 确保真机 canvas 2D 上下文可用；
      // 初始化仅探测 1 次并直接复用该探测 canvas 与 context 构造器，绝不重复创建！
      let _useOffscreen = false;
      let _cachedCtx2DCtor: any = null;
      let _cachedWebGLCtor: any = null;

      try {
        if (typeof _api.createOffscreenCanvas === 'function') {
          const _test = _api.createOffscreenCanvas({ type: '2d', width: 1, height: 1 });
          const _testCtx = _test.getContext('2d');
          if (_testCtx) {
            _useOffscreen = true;
            _cachedCtx2DCtor = _testCtx.constructor || Object;
            _poolState.totalCreated += 1;
            _poolState.pooledSet.add(_test);
            _poolState.pool.push(_test);
          }
        }
      } catch (_) { /* 不支持则回退 */ }
      console.log('[pixiPatch] createOffscreenCanvas 可用:', _useOffscreen);

      const _rawCreate2DCanvas = (w?: number, h?: number): any => {
        let c: any;
        const cw = w && w > 0 ? w : 1;
        const ch = h && h > 0 ? h : 1;
        if (_useOffscreen) {
          try {
            c = _api.createOffscreenCanvas({ type: '2d', width: cw, height: ch });
          } catch (_) {
            c = _api.createCanvas();
          }
        } else {
          c = _api.createCanvas();
        }
        if (w !== undefined) c.width = w;
        if (h !== undefined) c.height = h;
        return c;
      };

      const _pooledCreate2DCanvas = (w?: number, h?: number): any => {
        _poolState.totalRequests = (_poolState.totalRequests || 0) + 1;
        if (_poolState.pool.length > 0) {
          const c = _poolState.pool.pop()!;
          _poolState.pooledSet.delete(c);
          _poolState.activeOut += 1;
          const cw = w !== undefined ? w : 1;
          const ch = h !== undefined ? h : 1;
          c.width = cw;
          c.height = ch;
          try {
            const ctx = c.getContext?.('2d');
            ctx?.setTransform?.(1, 0, 0, 1, 0, 0);
            if (cw > 0 && ch > 0) ctx?.clearRect?.(0, 0, cw, ch);
          } catch (_) { /* ignore */ }
          return c;
        }
        const c = _rawCreate2DCanvas(w, h);
        _poolState.totalCreated += 1;
        _poolState.activeOut += 1;
        return c;
      };

      settings.ADAPTER = {
        createCanvas: _pooledCreate2DCanvas,
        getCanvasRenderingContext2D: (): any => {
          if (_cachedCtx2DCtor) return _cachedCtx2DCtor;
          try {
            const c = _pooledCreate2DCanvas(1, 1);
            const ctx = c.getContext('2d');
            _cachedCtx2DCtor = ctx ? ctx.constructor : Object;
            recycle2DCanvas(c);
          } catch {
            _cachedCtx2DCtor = Object;
          }
          return _cachedCtx2DCtor;
        },
        getWebGLRenderingContext: (): any => {
          if (_cachedWebGLCtor) return _cachedWebGLCtor;
          try {
            const c = _api.createCanvas();
            // 业界已知：必须传 stencil:true，否则鸿蒙/部分安卓 stencil 不可用
            const gl = c.getContext('webgl', { stencil: true, antialias: false, alpha: true, depth: true });
            _cachedWebGLCtor = gl ? gl.constructor : Object;
            try { c.width = 0; c.height = 0; } catch (_) { /* ignore */ }
          } catch {
            _cachedWebGLCtor = Object;
          }
          return _cachedWebGLCtor;
        },
        getNavigator: (): any => ({
          userAgent: 'wxgame',
          gpu: null,
        }),
        getBaseUrl: (): string => '',
        getFontFaceSet: (): any => null,
        fetch: ((_url: any, _opts?: any): any => {
          return Promise.reject(new Error('fetch not available in mini game'));
        }) as any,
      } as any;
      console.log('[pixiPatch] PIXI.settings.ADAPTER 已配置为小游戏池化模式');
    } catch (e) {
      console.warn('[pixiPatch] ADAPTER 配置失败:', e);
    }
  } else if (settings.ADAPTER && typeof settings.ADAPTER.createCanvas === 'function') {
    // 浏览器 / WebGL 预览环境同样接入有界 2D Canvas 对象池，消除频繁创建 DOM Canvas 与 GC 抖动
    const _origCreateCanvas = settings.ADAPTER.createCanvas.bind(settings.ADAPTER);
    settings.ADAPTER.createCanvas = ((w?: number, h?: number): any => {
      _poolState.totalRequests = (_poolState.totalRequests || 0) + 1;
      if (_poolState.pool.length > 0) {
        const c = _poolState.pool.pop()!;
        _poolState.pooledSet.delete(c);
        _poolState.activeOut += 1;
        const cw = w !== undefined ? w : 1;
        const ch = h !== undefined ? h : 1;
        c.width = cw;
        c.height = ch;
        try {
          const ctx = c.getContext?.('2d');
          ctx?.setTransform?.(1, 0, 0, 1, 0, 0);
          if (cw > 0 && ch > 0) ctx?.clearRect?.(0, 0, cw, ch);
        } catch (_) { /* ignore */ }
        return c;
      }
      const c = _origCreateCanvas(w, h);
      _poolState.totalCreated += 1;
      _poolState.activeOut += 1;
      return c;
    }) as any;
  }
}

if (!(ShaderSystem.prototype as any).__patched) {

const GLSL_TO_SINGLE_SETTERS: Record<string, (gl: any, loc: any, cv: any, v: any) => void> = {
  vec3(gl, loc, cv, v) { (cv[0]!==v[0]||cv[1]!==v[1]||cv[2]!==v[2])&&(cv[0]=v[0],cv[1]=v[1],cv[2]=v[2],gl.uniform3f(loc,v[0],v[1],v[2])); },
  int(gl, loc, _c, v) { gl.uniform1i(loc, v); },
  ivec2(gl, loc, _c, v) { gl.uniform2i(loc, v[0], v[1]); },
  ivec3(gl, loc, _c, v) { gl.uniform3i(loc, v[0], v[1], v[2]); },
  ivec4(gl, loc, _c, v) { gl.uniform4i(loc, v[0], v[1], v[2], v[3]); },
  uint(gl, loc, _c, v) { gl.uniform1ui(loc, v); },
  uvec2(gl, loc, _c, v) { gl.uniform2ui(loc, v[0], v[1]); },
  uvec3(gl, loc, _c, v) { gl.uniform3ui(loc, v[0], v[1], v[2]); },
  uvec4(gl, loc, _c, v) { gl.uniform4ui(loc, v[0], v[1], v[2], v[3]); },
  bvec2(gl, loc, _c, v) { gl.uniform2i(loc, v[0], v[1]); },
  bvec3(gl, loc, _c, v) { gl.uniform3i(loc, v[0], v[1], v[2]); },
  bvec4(gl, loc, _c, v) { gl.uniform4i(loc, v[0], v[1], v[2], v[3]); },
  mat2(gl, loc, _c, v) { gl.uniformMatrix2fv(loc, false, v); },
  mat4(gl, loc, _c, v) { gl.uniformMatrix4fv(loc, false, v); },
};
const GLSL_TO_ARRAY_SETTERS: Record<string, (gl: any, loc: any, cv: any, v: any) => void> = {
  float(gl, loc, _c, v) { gl.uniform1fv(loc, v); },
  vec2(gl, loc, _c, v) { gl.uniform2fv(loc, v); },
  vec3(gl, loc, _c, v) { gl.uniform3fv(loc, v); },
  vec4(gl, loc, _c, v) { gl.uniform4fv(loc, v); },
  int(gl, loc, _c, v) { gl.uniform1iv(loc, v); },
  ivec2(gl, loc, _c, v) { gl.uniform2iv(loc, v); },
  ivec3(gl, loc, _c, v) { gl.uniform3iv(loc, v); },
  ivec4(gl, loc, _c, v) { gl.uniform4iv(loc, v); },
  uint(gl, loc, _c, v) { gl.uniform1uiv(loc, v); },
  uvec2(gl, loc, _c, v) { gl.uniform2uiv(loc, v); },
  uvec3(gl, loc, _c, v) { gl.uniform3uiv(loc, v); },
  uvec4(gl, loc, _c, v) { gl.uniform4uiv(loc, v); },
  bool(gl, loc, _c, v) { gl.uniform1iv(loc, v); },
  bvec2(gl, loc, _c, v) { gl.uniform2iv(loc, v); },
  bvec3(gl, loc, _c, v) { gl.uniform3iv(loc, v); },
  bvec4(gl, loc, _c, v) { gl.uniform4iv(loc, v); },
  sampler2D(gl, loc, _c, v) { gl.uniform1iv(loc, v); },
  samplerCube(gl, loc, _c, v) { gl.uniform1iv(loc, v); },
  sampler2DArray(gl, loc, _c, v) { gl.uniform1iv(loc, v); },
};

function patchedSyncUniforms(group: any, uniformData: any, ud: any, uv: any, renderer: any): void {
  let textureCount = 0, v: any = null, cv: any = null;
  const gl = renderer.gl;
  for (const i in group.uniforms) {
    const data = uniformData[i], uvi = uv[i], udi = ud[i], gu = group.uniforms[i];
    if (!data) { if (gu.group === true) renderer.shader.syncUniformGroup(uvi); continue; }
    if (data.type==='float'&&data.size===1&&!data.isArray) { if(uvi!==udi.value){udi.value=uvi;gl.uniform1f(udi.location,uvi);} }
    else if (data.type==='bool'&&data.size===1&&!data.isArray) { if(uvi!==udi.value){udi.value=uvi;gl.uniform1i(udi.location,Number(uvi));} }
    else if ((data.type==='sampler2D'||data.type==='samplerCube'||data.type==='sampler2DArray')&&data.size===1&&!data.isArray) {
      renderer.texture.bind(uvi,textureCount); if(udi.value!==textureCount){udi.value=textureCount;gl.uniform1i(udi.location,textureCount);} textureCount++;
    } else if (data.type==='mat3'&&data.size===1&&!data.isArray) {
      gu.a!==void 0?gl.uniformMatrix3fv(udi.location,false,uvi.toArray(true)):gl.uniformMatrix3fv(udi.location,false,uvi);
    } else if (data.type==='vec2'&&data.size===1&&!data.isArray) {
      if(gu.x!==void 0){cv=udi.value;v=uvi;(cv[0]!==v.x||cv[1]!==v.y)&&(cv[0]=v.x,cv[1]=v.y,gl.uniform2f(udi.location,v.x,v.y));}
      else{cv=udi.value;v=uvi;(cv[0]!==v[0]||cv[1]!==v[1])&&(cv[0]=v[0],cv[1]=v[1],gl.uniform2f(udi.location,v[0],v[1]));}
    } else if (data.type==='vec4'&&data.size===1&&!data.isArray) {
      if(gu.width!==void 0){cv=udi.value;v=uvi;(cv[0]!==v.x||cv[1]!==v.y||cv[2]!==v.width||cv[3]!==v.height)&&(cv[0]=v.x,cv[1]=v.y,cv[2]=v.width,cv[3]=v.height,gl.uniform4f(udi.location,v.x,v.y,v.width,v.height));}
      else{cv=udi.value;v=uvi;(cv[0]!==v[0]||cv[1]!==v[1]||cv[2]!==v[2]||cv[3]!==v[3])&&(cv[0]=v[0],cv[1]=v[1],cv[2]=v[2],cv[3]=v[3],gl.uniform4f(udi.location,v[0],v[1],v[2],v[3]));}
    } else { (data.size===1&&!data.isArray?GLSL_TO_SINGLE_SETTERS:GLSL_TO_ARRAY_SETTERS)[data.type].call(null,gl,udi.location,udi.value,uvi); }
  }
}

Object.assign(ShaderSystem.prototype, {
  __patched: true,
  systemCheck() { /* 禁用 eval 检测 */ },
  syncUniforms(group: any, glProgram: any) {
    const self = this as any;
    patchedSyncUniforms(group, self.shader.program.uniformData, glProgram.uniformData, group.uniforms, self.renderer);
  },
});

console.log('[pixiPatch] unsafe-eval patch 已应用');

// ======== 真机 Canvas 纹理单次直传 patch ========
const _isRealDevice = (() => {
  try {
    if (!_api) return false;
    const info = _api.getSystemInfoSync();
    console.log('[pixiPatch] platform:', info.platform, 'brand:', info.brand, 'model:', info.model);
    return info.platform !== 'devtools';
  } catch { return false; }
})();
console.log('[pixiPatch] _isRealDevice:', _isRealDevice);

if (_isRealDevice) {
  // ---- 1) 强制用纯像素数据创建 Texture.WHITE（完全绕过 Canvas） ----
  const whitePixels = new Uint8Array(16 * 16 * 4);
  whitePixels.fill(255);
  const whiteBT = BaseTexture.fromBuffer(whitePixels, 16, 16);
  const whiteTex = new Texture(whiteBT);
  (whiteTex as any).destroy = () => {};
  try { Object.defineProperty(Texture, '_WHITE', { value: whiteTex, writable: true, configurable: true }); } catch (_e) { /* */ }
  try { Object.defineProperty(Texture, 'WHITE', { get: () => whiteTex, configurable: true }); } catch (_e) { /* */ }
  console.log('[pixiPatch] Texture.WHITE 已用 fromBuffer 重建（绕过 Canvas）');

  // ---- 2) 真机 Canvas 纹理单次上传（消除 _origUpload 废上传 + 双重 gl.texImage2D 卡顿） ----
  const _origUpload = BaseImageResource.prototype.upload;
  let _uploadLog = 0;
  let _inUpload = false;

  // 预检测一次 getImageData 是否返回有效像素，测完立即回收探测 canvas
  let _canReadPixels = false;
  try {
    const tc = settings.ADAPTER.createCanvas(4, 4);
    try {
      const tctx = tc.getContext('2d');
      if (tctx) {
        tctx.fillStyle = '#FF0000';
        tctx.fillRect(0, 0, 4, 4);
        const td = tctx.getImageData(0, 0, 1, 1).data;
        _canReadPixels = td[0] > 200 && td[3] > 200;
      }
    } finally {
      recycle2DCanvas(tc);
    }
  } catch (_) { /* */ }
  console.log('[pixiPatch] canvas getImageData 可用:', _canReadPixels);

  BaseImageResource.prototype.upload = function (
    renderer: any, baseTexture: any, glTexture: any, source?: any,
  ): boolean {
    if (_inUpload) {
      return _origUpload.call(this, renderer, baseTexture, glTexture, source);
    }
    _inUpload = true;

    try {
      source = source || this.source;

      // 针对小游戏 2D Canvas 源（独有 toTempFilePathSync）：直接单次上传像素缓冲，跳过无效的 _origUpload！
      if (_canReadPixels
          && source
          && source.width > 0 && source.height > 0
          && typeof source.getContext === 'function'
          && typeof source.toTempFilePathSync === 'function') {
        try {
          const ctx = source.getContext('2d');
          if (ctx && typeof ctx.getImageData === 'function') {
            const w = source.width;
            const h = source.height;
            const imageData = ctx.getImageData(0, 0, w, h);
            const pixels = new Uint8Array(
              imageData.data.buffer,
              imageData.data.byteOffset,
              imageData.data.byteLength,
            );

            const gl = renderer.gl;
            gl.bindTexture(gl.TEXTURE_2D, glTexture.texture);
            glTexture.width = w;
            glTexture.height = h;
            gl.pixelStorei(
              gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,
              baseTexture.alphaMode > 0 ? 1 : 0,
            );
            gl.texImage2D(
              gl.TEXTURE_2D,
              0,
              glTexture.internalFormat,
              w,
              h,
              0,
              baseTexture.format,
              glTexture.type,
              pixels,
            );

            if (_uploadLog < 3) {
              console.log('[pixiPatch] canvas 单次直传成功:', w, 'x', h);
              _uploadLog++;
            }
            return true;
          }
        } catch (e) {
          if (_uploadLog < 8) {
            console.warn('[pixiPatch] canvas 直传异常，回退原始路径:', e);
            _uploadLog++;
          }
        }
      }

      return _origUpload.call(this, renderer, baseTexture, glTexture, source);
    } finally {
      _inUpload = false;
    }
  };

  console.log('[pixiPatch] 真机 canvas 单次纹理直传 patch 已应用');
}

} // end if !__patched
