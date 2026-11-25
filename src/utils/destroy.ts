import * as PIXI from 'pixi.js';
import { Game } from '@/core/Game';
import { recycle2DCanvas } from '@/core/pixiUnsafeEvalPatch';
import { TweenManager } from '@/core/TweenManager';

function addNodeTweenTargets(node: PIXI.DisplayObject, out: Set<any>): void {
  out.add(node);
  const anyNode = node as any;
  if (anyNode.scale && typeof anyNode.scale === 'object') out.add(anyNode.scale);
  if (anyNode.position && typeof anyNode.position === 'object') out.add(anyNode.position);
  if (anyNode.pivot && typeof anyNode.pivot === 'object') out.add(anyNode.pivot);
  if (anyNode.skew && typeof anyNode.skew === 'object') out.add(anyNode.skew);
}

/** 判断节点是否未销毁且仍挂在 Game.stage 活动显示树上（防孤儿子树无限循环补间泄漏）。 */
export function isStageMounted(node: PIXI.DisplayObject | null | undefined): boolean {
  if (!node || node.destroyed) return false;
  const stage = Game.stage;
  if (!stage) return false;
  let cur: PIXI.DisplayObject | null = node;
  while (cur) {
    if (cur.destroyed) return false;
    if (cur === stage) return true;
    cur = cur.parent;
  }
  return false;
}

function destroySingleNode(node: PIXI.DisplayObject): void {
  if (node.destroyed) return;
  try { node.removeAllListeners?.(); } catch { /* ignore */ }
  try { (node as PIXI.Container).mask = null; } catch { /* ignore */ }
  try { node.filters = null; } catch { /* ignore */ }

  // PIXI.Text 继承自 PIXI.Sprite，必须先于 Sprite 分支判断，彻底释放其独占离屏 Canvas 与 WebGL BaseTexture 并回收到对象池
  if (node instanceof PIXI.Text) {
    const textCanvas = (node as any).canvas || (node as any)._canvas;
    try {
      node.destroy({ children: false, texture: true, baseTexture: true });
    } catch { /* ignore */ }
    if (textCanvas) {
      recycle2DCanvas(textCanvas);
    }
    return;
  }

  // NineSlicePlane / SimplePlane / Mesh：保留共享贴图与全局持久化单位几何缓冲，仅释放实例私有的 PlaneGeometry WebGL 顶点缓冲
  if (node instanceof PIXI.SimplePlane || node instanceof PIXI.Mesh) {
    const geom = node.geometry;
    const isSharedPersistent = Boolean((geom as any)?.__sharedPersistent);
    try {
      node.destroy({ children: false, texture: false, baseTexture: false });
    } catch { /* ignore */ }
    if (!isSharedPersistent) {
      try {
        geom?.destroy?.();
      } catch { /* ignore */ }
    }
    return;
  }

  // Sprite：严禁销毁 gameTexture 共享缓存贴图与 BaseTexture
  if (node instanceof PIXI.Sprite) {
    try {
      node.destroy({ children: false, texture: false, baseTexture: false });
    } catch { /* ignore */ }
    return;
  }

  // Graphics：释放独立几何缓冲与索引缓冲
  if (node instanceof PIXI.Graphics) {
    try {
      node.destroy({ children: false, texture: false, baseTexture: false });
    } catch { /* ignore */ }
    return;
  }

  try {
    node.destroy({ children: false });
  } catch { /* ignore */ }
}

/**
 * 安全销毁单个显示节点及其整棵子树（先取消全部活跃补间，自底向上按节点类型精确释放 GPU 纹理/几何缓冲）。
 */
export function destroyDisplayNode(root: PIXI.DisplayObject | null | undefined): void {
  if (!root || root.destroyed) return;
  if (root.parent) {
    try { root.parent.removeChild(root); } catch { /* ignore */ }
  }

  const postOrder: PIXI.DisplayObject[] = [];
  const stack: PIXI.DisplayObject[] = [root];
  const tweenTargets = TweenManager.activeCount > 0 ? new Set<any>() : null;

  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (!cur || cur.destroyed) continue;
    if (tweenTargets) addNodeTweenTargets(cur, tweenTargets);
    postOrder.push(cur);
    if (cur instanceof PIXI.Container && cur.children.length > 0) {
      const kids = cur.removeChildren();
      for (let i = 0; i < kids.length; i++) {
        stack.push(kids[i]);
      }
    }
  }

  if (tweenTargets && tweenTargets.size > 0) {
    TweenManager.cancelTargets(tweenTargets);
  }

  for (let i = postOrder.length - 1; i >= 0; i--) {
    destroySingleNode(postOrder[i]);
  }
}

/**
 * 安全清空并递归销毁容器内的全部子节点（保留容器自身可继续复用）。
 * - 彻底释放 PIXI.Text 独享的离屏 HTMLCanvasElement + WebGL BaseTexture；
 * - 释放 PIXI.Graphics / NineSlicePlane 的 WebGL 顶点与索引缓冲；
 * - 保护 PIXI.Sprite 引用的 gameTexture 共享图片缓存贴图不被误毁；
 * - 同步取消所有子节点及 scale/position/pivot 上的活跃补间动画，杜绝死节点闭包驻留。
 */
export function destroyDisplayChildren(container: PIXI.Container | null | undefined): void {
  if (!container || container.destroyed || container.children.length === 0) return;

  const removed = container.removeChildren();
  const postOrder: PIXI.DisplayObject[] = [];
  const stack: PIXI.DisplayObject[] = [];
  const tweenTargets = TweenManager.activeCount > 0 ? new Set<any>() : null;

  for (let i = 0; i < removed.length; i++) {
    if (removed[i] && !removed[i].destroyed) {
      stack.push(removed[i]);
    }
  }

  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (!cur || cur.destroyed) continue;
    if (tweenTargets) addNodeTweenTargets(cur, tweenTargets);
    postOrder.push(cur);
    if (cur instanceof PIXI.Container && cur.children.length > 0) {
      const kids = cur.removeChildren();
      for (let i = 0; i < kids.length; i++) {
        stack.push(kids[i]);
      }
    }
  }

  if (tweenTargets && tweenTargets.size > 0) {
    TweenManager.cancelTargets(tweenTargets);
  }

  for (let i = postOrder.length - 1; i >= 0; i--) {
    destroySingleNode(postOrder[i]);
  }
}
