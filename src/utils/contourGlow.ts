import * as PIXI from 'pixi.js';
import type { RarityTier } from '@/sim/rarity';

export interface SpriteContourOptions {
  selected?: boolean;
  onDark?: boolean;
  thicknessScale?: number;
  alpha?: number;
  pulse?: boolean;
}

interface ContourTierVisual {
  core: readonly [number, number, number];
  rim: readonly [number, number, number];
  lightAlpha: number;
  darkAlpha: number;
  selectedAlpha: number;
  lightHalo: number;
  darkHalo: number;
  selectedHalo: number;
}

function rgb01(hex: number): readonly [number, number, number] {
  return [
    ((hex >> 16) & 0xff) / 255,
    ((hex >> 8) & 0xff) / 255,
    (hex & 0xff) / 255,
  ] as const;
}

/**
 * 五阶明亮清透轮廓配色（内亮芯 + 品阶饱和轮廓）：
 * - common（仅 selected 或 onDark）：内亮芯暖奶油白 #FFF8E2 + 柔和暖金米外沿 #E8BE68
 * - rare（良品）：内亮芯嫩翠白 #B8FFC0 + 清亮翡翠绿轮廓 #2ED648
 * - epic（上品）：内亮芯冰晶白 #C8ECFF + 清透晴空蓝轮廓 #288CFA
 * - legendary（珍品）：内亮芯樱紫白 #F4D0FF + 明亮紫罗兰轮廓 #A242F5
 * - god（传世/天选）：内亮芯耀金白 #FFF8C4 + 璀璨鎏金琥珀轮廓 #FF9814
 */
const CONTOUR_PALETTE: Record<RarityTier, ContourTierVisual> = {
  common: {
    core: rgb01(0xFFF8E2),
    rim: rgb01(0xE8BE68),
    lightAlpha: 0.86,
    darkAlpha: 0.78,
    selectedAlpha: 0.95,
    lightHalo: 0.42,
    darkHalo: 0.46,
    selectedHalo: 0.62,
  },
  rare: {
    core: rgb01(0xB8FFC0),
    rim: rgb01(0x2ED648),
    lightAlpha: 0.88,
    darkAlpha: 0.94,
    selectedAlpha: 0.98,
    lightHalo: 0.42,
    darkHalo: 0.54,
    selectedHalo: 0.68,
  },
  epic: {
    core: rgb01(0xC8ECFF),
    rim: rgb01(0x288CFA),
    lightAlpha: 0.90,
    darkAlpha: 0.96,
    selectedAlpha: 1.0,
    lightHalo: 0.46,
    darkHalo: 0.58,
    selectedHalo: 0.72,
  },
  legendary: {
    core: rgb01(0xF4D0FF),
    rim: rgb01(0xA242F5),
    lightAlpha: 0.94,
    darkAlpha: 0.98,
    selectedAlpha: 1.0,
    lightHalo: 0.52,
    darkHalo: 0.64,
    selectedHalo: 0.76,
  },
  god: {
    core: rgb01(0xFFF8C4),
    rim: rgb01(0xFF9814),
    lightAlpha: 0.96,
    darkAlpha: 1.0,
    selectedAlpha: 1.0,
    lightHalo: 0.58,
    darkHalo: 0.70,
    selectedHalo: 0.80,
  },
};

const VERT_SRC = `
precision mediump float;

attribute vec2 aVertexPosition;
uniform mat3 projectionMatrix;
uniform vec4 uQuad01;
uniform vec4 uQuad32;
uniform vec4 uLocalUvBounds;

varying vec2 vLocalUv;

void main(void) {
  vec2 topPos = mix(uQuad01.xy, uQuad01.zw, aVertexPosition.x);
  vec2 botPos = mix(uQuad32.xy, uQuad32.zw, aVertexPosition.x);
  vec2 worldPos = mix(topPos, botPos, aVertexPosition.y);
  vLocalUv = mix(uLocalUvBounds.xy, uLocalUvBounds.zw, aVertexPosition);
  gl_Position = vec4((projectionMatrix * vec3(worldPos, 1.0)).xy, 0.0, 1.0);
}
`;

const FRAG_SRC = `
precision mediump float;

varying vec2 vLocalUv;

uniform sampler2D uSampler;
uniform vec2 uUvOrigin;
uniform vec4 uUvAxes;
uniform vec4 uRadii;
uniform vec3 uCoreColor;
uniform vec3 uRimColor;
uniform vec3 uParams;

float sampleAlpha(vec2 uv) {
  float inside = step(0.0005, uv.x) * step(uv.x, 0.9995) * step(0.0005, uv.y) * step(uv.y, 0.9995);
  vec2 cuv = clamp(uv, 0.001, 0.999);
  vec2 texUv = uUvOrigin + uUvAxes.xy * cuv.x + uUvAxes.zw * cuv.y;
  return texture2D(uSampler, texUv, -8.0).a * inside;
}

void main(void) {
  float centerA = sampleAlpha(vLocalUv);
  float outerOnly = 1.0 - smoothstep(0.65, 0.95, centerA);

  vec2 rIn = uRadii.xy;
  vec2 rInDiag = rIn * 0.70710678;

  float i0 = sampleAlpha(vLocalUv + vec2(rIn.x, 0.0));
  float i1 = sampleAlpha(vLocalUv - vec2(rIn.x, 0.0));
  float i2 = sampleAlpha(vLocalUv + vec2(0.0, rIn.y));
  float i3 = sampleAlpha(vLocalUv - vec2(0.0, rIn.y));
  float i4 = sampleAlpha(vLocalUv + vec2(rInDiag.x, rInDiag.y));
  float i5 = sampleAlpha(vLocalUv + vec2(-rInDiag.x, rInDiag.y));
  float i6 = sampleAlpha(vLocalUv + vec2(rInDiag.x, -rInDiag.y));
  float i7 = sampleAlpha(vLocalUv + vec2(-rInDiag.x, -rInDiag.y));

  float innerMax = max(max(max(i0, i1), max(i2, i3)), max(max(i4, i5), max(i6, i7)));
  float innerAvg = (i0 + i1 + i2 + i3 + i4 + i5 + i6 + i7) * 0.125;
  float strokeSignal = mix(innerMax, innerAvg, 0.16);
  float strokeMask = smoothstep(0.10, 0.56, strokeSignal);

  vec2 rOut = uRadii.zw;
  vec2 oA = vec2(rOut.x * 0.9238795, rOut.y * 0.3826834);
  vec2 oB = vec2(rOut.x * 0.3826834, rOut.y * 0.9238795);

  float o0 = sampleAlpha(vLocalUv + oA);
  float o1 = sampleAlpha(vLocalUv - oA);
  float o2 = sampleAlpha(vLocalUv + vec2(-oA.x, oA.y));
  float o3 = sampleAlpha(vLocalUv + vec2(oA.x, -oA.y));
  float o4 = sampleAlpha(vLocalUv + oB);
  float o5 = sampleAlpha(vLocalUv - oB);
  float o6 = sampleAlpha(vLocalUv + vec2(-oB.x, oB.y));
  float o7 = sampleAlpha(vLocalUv + vec2(oB.x, -oB.y));

  float outerAvg = (o0 + o1 + o2 + o3 + o4 + o5 + o6 + o7) * 0.125;
  float haloField = max(outerAvg, innerAvg * 0.62);
  float haloMask = smoothstep(0.025, 0.48, haloField) * uParams.y;

  float combinedA = clamp(max(strokeMask * 0.97, haloMask), 0.0, 1.0) * outerOnly * uParams.x;
  float vis = step(0.003, combinedA);
  float coreMix = strokeMask * smoothstep(0.24, 0.72, innerAvg) * uParams.z;
  vec3 col = mix(uRimColor, uCoreColor, coreMix);
  float outA = combinedA * vis;
  gl_FragColor = vec4(col * outA, outA);
}
`;

let _sharedGeom: PIXI.Geometry | null = null;
let _sharedProgram: PIXI.Program | null = null;
let _sharedState: PIXI.State | null = null;

function getSharedContourGeometry(): PIXI.Geometry {
  if (!_sharedGeom) {
    const geom = new PIXI.Geometry()
      .addAttribute('aVertexPosition', [0, 0, 1, 0, 1, 1, 0, 1], 2)
      .addIndex([0, 1, 2, 0, 2, 3]);
    (geom as any).__sharedPersistent = true;
    // 永久持有 +1 引用计数，防止最后一个实例卸载时触发 VAO 自动 dispose
    geom.refCount += 1;
    _sharedGeom = geom;
  }
  return _sharedGeom;
}

function getSharedContourProgram(): PIXI.Program {
  if (!_sharedProgram) {
    _sharedProgram = new PIXI.Program(VERT_SRC, FRAG_SRC, 'jiancai-contour-rim');
  }
  return _sharedProgram;
}

function getSharedContourState(): PIXI.State {
  if (!_sharedState) {
    const st = PIXI.State.for2d();
    st.blendMode = PIXI.BLEND_MODES.NORMAL;
    _sharedState = st;
  }
  return _sharedState;
}

/**
 * WebGL 零 FBO 双层边缘轮廓发光网格（无 Filter、无 RenderTexture、无 2D Canvas）：
 * 共享单个 4 顶点单位矩形 Geometry 与单个编译后 Program，实时贴合目标 Sprite 的真实非透明剪影边缘。
 */
export class ContourRimMesh extends PIXI.Mesh<PIXI.Shader> {
  targetSprite: PIXI.Sprite | null;

  private _rarity: RarityTier;
  private _selected: boolean;
  private _onDark: boolean;
  private _thicknessScale: number;
  private _baseAlpha: number;
  private _haloGain: number;
  private _coreContrast: number;
  private _shouldPulse: boolean;
  private _phase: number;

  private readonly _uQuad01 = new Float32Array(4);
  private readonly _uQuad32 = new Float32Array(4);
  private readonly _uLocalUvBounds = new Float32Array(4);
  private readonly _uUvOrigin = new Float32Array(2);
  private readonly _uUvAxes = new Float32Array([0, 0, 1, 1]);
  private readonly _uRadii = new Float32Array(4);
  private readonly _uCoreColor = new Float32Array(3);
  private readonly _uRimColor = new Float32Array(3);
  private readonly _uParams = new Float32Array(3);

  constructor(targetSprite: PIXI.Sprite, rarity: RarityTier, opts?: SpriteContourOptions) {
    const geom = getSharedContourGeometry();
    const program = getSharedContourProgram();
    const state = getSharedContourState();

    const uQuad01 = new Float32Array(4);
    const uQuad32 = new Float32Array(4);
    const uLocalUvBounds = new Float32Array(4);
    const uUvOrigin = new Float32Array(2);
    const uUvAxes = new Float32Array([1, 0, 0, 1]);
    const uRadii = new Float32Array(4);
    const uCoreColor = new Float32Array(3);
    const uRimColor = new Float32Array(3);
    const uParams = new Float32Array(3);

    const shader = new PIXI.Shader(program, {
      uSampler: PIXI.Texture.WHITE.baseTexture,
      uQuad01,
      uQuad32,
      uLocalUvBounds,
      uUvOrigin,
      uUvAxes,
      uRadii,
      uCoreColor,
      uRimColor,
      uParams,
    });

    super(geom, shader, state, PIXI.DRAW_MODES.TRIANGLES);

    this._uQuad01 = uQuad01;
    this._uQuad32 = uQuad32;
    this._uLocalUvBounds = uLocalUvBounds;
    this._uUvOrigin = uUvOrigin;
    this._uUvAxes = uUvAxes;
    this._uRadii = uRadii;
    this._uCoreColor = uCoreColor;
    this._uRimColor = uRimColor;
    this._uParams = uParams;

    this.targetSprite = targetSprite;
    this.eventMode = 'none';
    this._phase = Math.random() * Math.PI * 2;

    this._rarity = rarity;
    this._selected = false;
    this._onDark = false;
    this._thicknessScale = 1;
    this._baseAlpha = 1;
    this._haloGain = 0.5;
    this._coreContrast = 0.5;
    this._shouldPulse = false;

    this.configure(rarity, opts);
  }

  configure(rarity: RarityTier, opts?: SpriteContourOptions): void {
    const pal = CONTOUR_PALETTE[rarity] ?? CONTOUR_PALETTE.common;
    const selected = Boolean(opts?.selected);
    const onDark = Boolean(opts?.onDark);

    this._rarity = rarity;
    this._selected = selected;
    this._onDark = onDark;
    this._thicknessScale = opts?.thicknessScale ?? (selected ? 1.12 : 1.0);
    this._baseAlpha = opts?.alpha ?? (
      selected
        ? pal.selectedAlpha
        : onDark
          ? pal.darkAlpha
          : pal.lightAlpha
    );
    this._haloGain = selected
      ? (onDark ? Math.min(0.86, pal.selectedHalo + 0.06) : pal.selectedHalo)
      : (onDark ? pal.darkHalo : pal.lightHalo);
    this._coreContrast = onDark ? 0.78 : (selected ? 0.52 : 0.42);
    this._shouldPulse = opts?.pulse !== undefined
      ? opts.pulse
      : (selected || rarity === 'legendary' || rarity === 'god');

    this._uCoreColor[0] = pal.core[0];
    this._uCoreColor[1] = pal.core[1];
    this._uCoreColor[2] = pal.core[2];
    this._uRimColor[0] = pal.rim[0];
    this._uRimColor[1] = pal.rim[1];
    this._uRimColor[2] = pal.rim[2];
  }

  protected override _calculateBounds(): void {
    // 装饰性贴边轮廓不扩大父容器的交互/布局包围盒，确保新手引导框与滚轴尺寸零偏移
  }

  override containsPoint(_point: PIXI.IPointData): boolean {
    return false;
  }

  protected override _render(renderer: PIXI.Renderer): void {
    const sp = this.targetSprite;
    if (
      !sp
      || sp.destroyed
      || !sp.visible
      || !sp.renderable
      || sp.worldAlpha <= 0.01
      || this.worldAlpha <= 0.01
    ) {
      return;
    }

    const tex = sp.texture;
    const baseTex = tex?.baseTexture;
    if (
      !tex
      || !tex.valid
      || !baseTex
      || !baseTex.valid
      || baseTex.destroyed
      || tex.width <= 2
      || tex.height <= 2
    ) {
      return;
    }

    const spW = Math.abs(sp.width);
    const spH = Math.abs(sp.height);
    if (spW <= 2 || spH <= 2) {
      return;
    }

    if (!renderer.gl || !renderer.shader || !renderer.geometry) {
      return;
    }

    const sx = Math.abs(sp.scale.x);
    const sy = Math.abs(sp.scale.y);
    if (sx <= 1e-5 || sy <= 1e-5) {
      return;
    }

    const orig = tex.orig;
    const trim = tex.trim;
    const frameOrigW = trim ? trim.width : orig.width;
    const frameOrigH = trim ? trim.height : orig.height;
    if (frameOrigW <= 2 || frameOrigH <= 2) {
      return;
    }

    const quadW = frameOrigW * sx;
    const quadH = frameOrigH * sy;
    if (quadW <= 2 || quadH <= 2) {
      return;
    }

    // 若目标 Sprite 在本帧渲染回调中发生过属性变更，确保其 worldTransform 已同步
    const spTr = sp.transform as any;
    const parentTr = sp.parent?.transform as any;
    if (spTr && parentTr && (spTr._localID !== spTr._currentLocalID || spTr._parentID !== parentTr._worldID)) {
      sp.transform.updateTransform(sp.parent.transform);
    }

    if (!(tex as any)._uvs) {
      tex.updateUvs();
    }
    const uvs = (tex as any)._uvs;
    if (!uvs) return;

    const minDim = Math.min(quadW, quadH);
    const sizeAdapt = Math.min(1.16, Math.max(0.68, minDim / 108));
    const effThick = this._thicknessScale * sizeAdapt;

    const padPx = Math.ceil(12 * effThick);
    const padU = padPx / quadW;
    const padV = padPx / quadH;
    const uMin = -padU;
    const vMin = -padV;
    const uMax = 1.0 + padU;
    const vMax = 1.0 + padV;

    const baseX = (trim ? trim.x : 0) - sp.anchor.x * orig.width;
    const baseY = (trim ? trim.y : 0) - sp.anchor.y * orig.height;
    const lx0 = baseX + uMin * frameOrigW;
    const lx1 = baseX + uMax * frameOrigW;
    const ly0 = baseY + vMin * frameOrigH;
    const ly1 = baseY + vMax * frameOrigH;

    const wt = sp.transform.worldTransform;
    const a = wt.a;
    const b = wt.b;
    const c = wt.c;
    const d = wt.d;
    const tx = wt.tx;
    const ty = wt.ty;

    this._uQuad01[0] = a * lx0 + c * ly0 + tx;
    this._uQuad01[1] = b * lx0 + d * ly0 + ty;
    this._uQuad01[2] = a * lx1 + c * ly0 + tx;
    this._uQuad01[3] = b * lx1 + d * ly0 + ty;

    this._uQuad32[0] = a * lx0 + c * ly1 + tx;
    this._uQuad32[1] = b * lx0 + d * ly1 + ty;
    this._uQuad32[2] = a * lx1 + c * ly1 + tx;
    this._uQuad32[3] = b * lx1 + d * ly1 + ty;

    this._uLocalUvBounds[0] = uMin;
    this._uLocalUvBounds[1] = vMin;
    this._uLocalUvBounds[2] = uMax;
    this._uLocalUvBounds[3] = vMax;

    this._uUvOrigin[0] = uvs.x0;
    this._uUvOrigin[1] = uvs.y0;
    this._uUvAxes[0] = uvs.x1 - uvs.x0;
    this._uUvAxes[1] = uvs.y1 - uvs.y0;
    this._uUvAxes[2] = uvs.x3 - uvs.x0;
    this._uUvAxes[3] = uvs.y3 - uvs.y0;

    // 内环 ~2.6px 清晰明亮贴边轮廓线；外环 ~7.0px 柔和贴边微光晕
    const innerPx = 2.6 * effThick;
    const outerPx = 7.0 * effThick;
    this._uRadii[0] = innerPx / quadW;
    this._uRadii[1] = innerPx / quadH;
    this._uRadii[2] = outerPx / quadW;
    this._uRadii[3] = outerPx / quadH;

    let pulseMul = 1.0;
    if (this._shouldPulse) {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      pulseMul = 1.0 + 0.08 * Math.sin(now * 0.0042 + this._phase);
    }

    const finalAlpha = Math.min(1.0, Math.max(0.0, sp.worldAlpha * this.alpha * this._baseAlpha * pulseMul));
    if (finalAlpha <= 0.01) {
      return;
    }

    this._uParams[0] = finalAlpha;
    this._uParams[1] = this._haloGain;
    this._uParams[2] = this._coreContrast;

    const shader = this.shader;
    if (!shader) return;
    (shader.uniforms as any).uSampler = baseTex;

    renderer.batch.flush();
    renderer.shader.bind(shader);
    renderer.state.set(this.state);
    renderer.geometry.bind(this.geometry, shader);
    renderer.geometry.draw(PIXI.DRAW_MODES.TRIANGLES, 6, 0);
  }

  override destroy(_options?: PIXI.IDestroyOptions | boolean): void {
    if (this.destroyed) return;
    this.targetSprite = null;

    const geom = (this as any)._geometry as PIXI.Geometry | null;
    if (geom && geom.refCount > 1) {
      geom.refCount -= 1;
    }
    (this as any)._geometry = null;

    if (this.shader) {
      try {
        (this.shader.uniforms as any).uSampler = PIXI.Texture.WHITE.baseTexture;
        this.shader.destroy();
      } catch { /* ignore */ }
    }
    (this as any).shader = null;
    (this as any).state = null;
    (this as any).uvs = null;
    (this as any).indices = null;
    (this as any).vertexData = null;

    PIXI.Container.prototype.destroy.call(this, { children: false });
  }
}

/**
 * 为目标物品 Sprite 挂载紧贴其自身非透明边缘的双层发光轮廓（零 FBO / 零新贴图 / 零 2D Canvas）。
 * - 浅底且未选中的 `common` 物品直接返回 `null`，保持干净原画零开销；
 * - 若 `sprite` 已在 `parent.children` 中，自动插入到 `sprite` 正后方。
 */
export function attachSpriteContour(
  parent: PIXI.Container,
  sprite: PIXI.Sprite | null | undefined,
  rarity: RarityTier,
  opts?: SpriteContourOptions,
): PIXI.DisplayObject | null {
  if (!parent || parent.destroyed || !sprite || sprite.destroyed) {
    return null;
  }
  if (rarity === 'common' && !opts?.selected && !opts?.onDark) {
    return null;
  }

  const mesh = new ContourRimMesh(sprite, rarity, opts);
  if (sprite.parent === parent) {
    const idx = parent.getChildIndex(sprite);
    parent.addChildAt(mesh, idx);
  } else {
    parent.addChild(mesh);
  }
  return mesh;
}
