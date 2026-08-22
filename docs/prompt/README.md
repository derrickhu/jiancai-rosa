# 捡菜市集 prompt

1. 先读 [美术风格圣经](../美术风格圣经.md)。
2. 风格段原样粘贴 [`_style_block.txt`](./_style_block.txt)。
3. 原图输出到仓库外 `../game_assets/jiancai-rosa/assets/raw/`。对比选稿后：场景图压成 JPG 进 `minigame/images/`，食材/熟菜走切图+抠图+裁切再进游戏。

| 文件 | 用途 | 比例 |
|---|---|---|
| `kitchen_scene_prompt.txt` | 旧：整屋厨房（已拆） | 9:16 |
| `kitchen_room_prompt.txt` / `kitchen_room_wide_prompt.txt` | 旧：加宽横版空屋（已弃用） | 横版 |
| `kitchen_room_0_shack_prompt.txt` | 陋屋空屋（镜头基准） | 竖版 3:4 |
| `kitchen_room_1_modest_prompt.txt` | 精装屋空屋（锁陋屋机位，晨光奶油） | 竖版 3:4 |
| `kitchen_room_2_refined_prompt.txt` | 雅致屋空屋（锁陋屋机位，暖白浅橡） | 竖版 3:4 |
| `kitchen_fridge_*` / `cook` / `table` / `basket` / `foam` | 厨房独立设备 | 道具 |
| `kitchen_table_island_lv6_10_prompt.txt` | 旧：桌子 6–10 级岛台 | 16:9 |
| `kitchen_table_station_lv0_4_prompt.txt` | 旧：烹饪台 0–4 带腿木桌 | 5 格横条 |
| `kitchen_table_camp_island_prompt.txt` | 烹饪台 4 级起：蛋卷桌→岛台→大理石 | 1:1 |
| `kitchen_fridge_lv6_9_prompt.txt` | 冰箱 6–9：加大并换色（蓝/银对开） | 1:1 |
| `hud_coin_prompt.txt` / `hud_stamina_prompt.txt` | 顶栏货币/体力图标 | 1:1 |
| `icon_wechat_shared.txt` / `icon_01`–`icon_05_*` | 微信小游戏头像《天黑请捡漏》五风格 | 1:1 |
| `loading_bg_prompt.txt` | 启动页夜市底图（圆月+街上果蔬水产，无字） | 9:16 |
| `title_logo_prompt.txt` | 标题字「扫荡菜场」：扫荡张狂、菜场果蔬笔画 | 16:9 |
| `market_overview_prompt.txt` | 旧：市集总览（外层换卡片路线后只当选点缩略图） | 9:16 |
| `market_route_bg_prompt.txt` | 卡片路线底图（中间一列压暗留空给卡片） | 9:16 |
| `market_card_frame_prompt.txt` | 路线卡框（木框+纸面，入库前把纸面抠成透明窗口） | 3:4 |
| `market_cards_prompt.txt` | 12 格卡面缩略图集（4×3，四摊+事件+背面） | 1:1 |
| `market_freebie_bundle_prompt.txt` | 白捡卡面重画：地上一个扎口布包，看不出内容（单格贴回图集第 6 格） | 3:4 |
| `npc_market_busts_prompt.txt` | 事件对话半身像两连（巷口张婶、收摊摊主），平灰底待抠 | 4:3 |
| `ui_event_gain_prompt.txt` | 白捡弹窗壳体（木框奶油纸，顶角白菜大蒜） | 3:4 |
| `ui_event_talk_prompt.txt` | 事件对话壳体（挂牌木框奶油纸，两侧灯笼） | 16:9 |
| `stall_rummage_*_prompt.txt` | 四摊翻堆底 | 4:3 |
| `stall_pile_*_prompt.txt` | 四摊遮挡堆（点堆抽取） | 1:1 |
| `items_leaf_prompt.txt` 等 | 食材表 | 4:3 |
| `dishes_prompt.txt` | 三道熟菜共用风格 | 1:1 |
| `dish_stirfry_prompt.txt` / `dish_tomato_egg_prompt.txt` / `dish_garlic_shrimp_prompt.txt` | 装盘成品菜（旧三道） | 1:1 |
| `dish_new_shared.txt` / `dish_batch01_prompt.txt` | 五十本里其余装盘菜 | 1:1 |
| `items_new_clean_prompt.txt` | 新食材干净态（按占格比例） | 随 w×h |
| `ui_fridge_panel_prompt.txt` | 冰箱形背包页（纯色腔体，顶栏/底栏留空） | 9:16 |
| `ui_fridge_btn_prompt.txt` | 冰箱页配套按钮板（奶油/砖红/胡桃） | 16:9 |
| `ui_cook_panel_prompt.txt` | 烹饪页菜谱书：布面精装+空白纸页，标题程序叠字 | 9:16 |
| `ui_cook_btn_prompt.txt` | 烹饪页专用大按钮（砖红布面，空心叠字） | 16:9 |
