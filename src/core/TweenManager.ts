export type EaseFunc = (t: number) => number;

export const Ease = {
  linear: (t: number) => t,
  easeInQuad: (t: number) => t * t,
  easeOutQuad: (t: number) => t * (2 - t),
  easeInOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  easeOutBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
  },
};

export interface TweenConfig {
  target: any;
  props: Record<string, number>;
  duration: number;
  ease?: EaseFunc;
  delay?: number;
  onUpdate?: () => void;
  onComplete?: () => void;
}

export interface ActiveTween {
  config: TweenConfig;
  startValues: Record<string, number>;
  elapsed: number;
  delayRemaining: number;
}

class TweenManagerClass {
  private _tweens: ActiveTween[] = [];

  to(config: TweenConfig): ActiveTween {
    const startValues: Record<string, number> = {};
    for (const key in config.props) {
      startValues[key] = config.target[key] ?? 0;
    }
    const tween: ActiveTween = {
      config,
      startValues,
      elapsed: 0,
      delayRemaining: config.delay || 0,
    };
    this._tweens.push(tween);
    return tween;
  }

  cancel(tween: ActiveTween): void {
    const idx = this._tweens.indexOf(tween);
    if (idx !== -1) this._tweens.splice(idx, 1);
  }

  cancelTarget(target: any): void {
    this._tweens = this._tweens.filter((t) => t.config.target !== target);
  }

  update(dt: number): void {
    const completed: ActiveTween[] = [];
    const aborted: ActiveTween[] = [];

    for (const tween of this._tweens) {
      if (tween.delayRemaining > 0) {
        tween.delayRemaining -= dt;
        continue;
      }

      const { config, startValues } = tween;
      const tgt = config.target;
      if (
        tgt == null
        || (typeof (tgt as { destroyed?: boolean }).destroyed === 'boolean'
          && (tgt as { destroyed: boolean }).destroyed)
      ) {
        aborted.push(tween);
        continue;
      }

      tween.elapsed += dt;
      const ease = config.ease || Ease.linear;
      const progress = Math.min(tween.elapsed / config.duration, 1);
      const easedProgress = ease(progress);

      try {
        for (const key in config.props) {
          const start = startValues[key];
          const end = config.props[key];
          config.target[key] = start + (end - start) * easedProgress;
        }
      } catch {
        aborted.push(tween);
        continue;
      }

      if (config.onUpdate) {
        try {
          config.onUpdate();
        } catch {
          aborted.push(tween);
          continue;
        }
      }

      if (progress >= 1) completed.push(tween);
    }

    for (const tween of aborted) {
      const idx = this._tweens.indexOf(tween);
      if (idx !== -1) this._tweens.splice(idx, 1);
    }
    for (const tween of completed) {
      const idx = this._tweens.indexOf(tween);
      if (idx !== -1) this._tweens.splice(idx, 1);
      tween.config.onComplete?.();
    }
  }
}

export const TweenManager = new TweenManagerClass();
