import type { Quality } from './items';

export type MinigameId = 'memory' | 'match' | 'merge';

/** 小游戏实例状态。具体字段由各 handler 自己扩。 */
export interface MinigameState {
  id: MinigameId;
  nodeId: string;
  done: boolean;
}

export interface MinigameReward {
  foods: Array<{ defId: string; quality: Quality }>;
}

/**
 * 小游戏契约。河沿翻牌记忆等下一轮再接 UI，
 * 进卡只认 encounter.type === 'minigame'，不要把玩法写进 CardKind。
 */
export interface MinigameHandler<S extends MinigameState = MinigameState> {
  id: MinigameId;
  start(nodeId: string): S;
  act(state: S, input: { type: string; [k: string]: unknown }): S;
  settle(state: S): MinigameReward;
}

export const MINIGAME_HANDLERS: Partial<Record<MinigameId, MinigameHandler>> = {};
