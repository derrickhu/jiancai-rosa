# 捡菜市集音频

温暖、干燥、近距、手作。木砧板、油纸、塑料袋、叶菜、黄昏巷口。不是水墨，不是像素，不是史诗 RPG。

## 音色家族

- **标志材质**：干燥木器、油纸、叶菜窸窣、小铜钱、铁锅轻响。
- **BGM 三件套**：尼龙吉他、暖钢琴、轻木鱼/沙锤。市集曲可加一点手风琴或口琴。
- **禁止**：史诗铜管、电子合成、长混响、人声、赌场金币、古筝大曲。

## 分工

| 类型 | 工具 | 产物 |
|---|---|---|
| 短音效 25 条 | ElevenLabs（`game-sfx-gen`） | `game_assets/jiancai-rosa/audio/final/*.mp3` |
| 背景音乐 | Suno（网页，无 API） | 下载后放 `game_assets/jiancai-rosa/audio/raw/`，去封面压到 128kbps 后进 `final/` |

确认后再拷进 `minigame/subpkg_audio/`。整目录走 CDN（对齐花花）：启动时下载到本地缓存，InnerAudio 只播 `wxfile://`，不读包内相对路径。

烹饪：打开烹饪台菜谱播 `cook_done`（锅碗），点烹饪播 `cook_sizzle`（煎炸）。出锅成功不再叠锅碗，升级音晚一秒再响。

## 爽感短句（不要交给 ElevenLabs）

ElevenLabs 写不准音高，Suno 最短也是整段曲子。这两条是玩家最重要的反馈，用锁定音高的卡林巴短句，**禁止 `--force` 覆盖**：

| 文件 | 来源 | 时长 | 何时 |
|---|---|---|---|
| `item_reveal.mp3` | 花花 `deco_obtain.mp3` | ~4.0s | 白捡 / 翻堆 / 采集 / 消耗天色拿到的，只要物品出现 |
| `result_safe.mp3` | 菜猪 `通关.mp3` | ~4.1s | 挑完回家 |
| `result_dusk.mp3` | 同上 | ~4.1s | 天黑收摊 |

## 生成音效

```bash
python3 ~/.cursor/skills/game-sfx-gen/scripts/gen_sfx.py \
  --manifest docs/prompt/audio/sfx_manifest.json --dry-run

python3 ~/.cursor/skills/game-sfx-gen/scripts/gen_sfx.py \
  --manifest docs/prompt/audio/sfx_manifest.json
```

## BGM（Suno）

**不要整段贴进 Lyrics。** Lyrics 会被当成歌词来唱，写了 `no vocals` 也会唱。

1. 打开 suno.com，用 **Advanced**。
2. **Styles**：只贴文件里「贴进 Styles」那一行（逗号风格标签）。
3. **Lyrics**：只贴 `[Instrumental]` 和段落标签，不要任何英文句子。
4. 若界面有 **Instrumental** 开关，打开。
5. 出曲后听一遍，确认没人声。下载 mp3 放到仓库外 `game_assets/jiancai-rosa/audio/raw/`。

| 文件 | 场景 | BPM / 调 |
|---|---|---|
| [bgm_kitchen_prompt.txt](./bgm_kitchen_prompt.txt) | 厨房 | 88 / C |
| [bgm_outing_prompt.txt](./bgm_outing_prompt.txt) | 选点街（夜、短、卡通） | 76 / Dm |
| [bgm_market_prompt.txt](./bgm_market_prompt.txt) | 市集（每场一首） | 108 / C |
| [result_safe_sting_prompt.txt](./result_safe_sting_prompt.txt) | 挑完回家结算短句 | 104 / C |
| [result_dusk_sting_prompt.txt](./result_dusk_sting_prompt.txt) | 天黑收摊结算短句 | 96 / C |

已接入的成品（`final/bgm_*.mp3` → `minigame/subpkg_audio/`）：

| 成品 | 原曲 | 场景 |
|---|---|---|
| `bgm_kitchen.mp3` | Evening in the Kitchen (1) | 厨房 |
| `bgm_outing.mp3` | Moonlit Alley | 选点街 |
| `bgm_market_xiangko.mp3` | Evening Stroll (1) | 巷口收摊 |
| `bgm_market_heyan.mp3` | Evening Stroll (2) | 河沿早市 |
| `bgm_market_shanwu.mp3` | Dusk Market (2) | 山坞早集 |
| `bgm_market_jiangbian.mp3` | Dusk Market (3) | 江边渔市 |
| `bgm_market_laocheng.mp3` | Dusk Market (2)（五场四曲，先复用山坞） | 老城菜行 |

## 清单

见 [sfx_manifest.json](./sfx_manifest.json)。`output` 指向仓库外 `game_assets/jiancai-rosa/audio/final/`。
