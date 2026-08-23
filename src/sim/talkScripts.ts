export interface TalkChoice {
  label: string;
  /** 选这项再耗几步天色。写在按钮上。 */
  steps?: number;
  grantFood?: string;
  grantItem?: string;
  setFlag?: string;
  gotoScene?: string;
}

export interface TalkScript {
  id: string;
  speaker: string;
  portrait: string | null;
  text: string;
  choices: TalkChoice[];
}

export const TALK_SCRIPTS: Record<string, TalkScript> = {
  shanwu_woodcutter: {
    id: 'shanwu_woodcutter',
    speaker: '砍柴的',
    portrait: 'subpkg_images/npc_shanwu_vendor.png',
    text: '这担柴散了。帮我捆一下？手上有刚挖的笋，也有一把潮菌。',
    choices: [
      { label: '帮一把，换笋', steps: 1, grantFood: 'bamboo_shoot', setFlag: 'helped_woodcutter' },
      { label: '帮一把，换菌', steps: 1, grantFood: 'mushroom', setFlag: 'helped_woodcutter' },
      { label: '没工夫' },
    ],
  },
};

export function talkScript(id: string): TalkScript | undefined {
  return TALK_SCRIPTS[id];
}
