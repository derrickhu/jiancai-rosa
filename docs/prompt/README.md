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
| `hud_home_prompt.txt` | 选点页回家：小屋图标 | 1:1 |
| `icon_wechat_shared.txt` / `icon_01`–`icon_05_*` | 微信小游戏头像《天黑请捡漏》五风格 | 1:1 |
| `loading_bg_prompt.txt` | 启动页夜市底图（圆月+街上果蔬水产，无字） | 9:16 |
| `title_logo_prompt.txt` | 标题字「扫荡菜场」：扫荡张狂、菜场果蔬笔画 | 16:9 |
| `market_overview_prompt.txt` | 旧：市集总览（外层换卡片路线后只当选点缩略图） | 9:16 |
| `market_route_bg_prompt.txt` | 巷口卡片路线底图（中间一列压暗留空给卡片） | 9:16 |
| `market_cartoon_lock.txt` | 后四个场必须锁回巷口卡通，禁止写实 | — |
| `market_route_heyan_prompt.txt` | 河沿早市路线底图（晨光、船、菜筐，中间压暗） | 9:16 |
| `market_route_shanwu_prompt.txt` | 山坞早集路线底图（石阶、竹棚，中间压暗） | 9:16 |
| `market_route_jiangbian_prompt.txt` | 江边渔市路线底图（夜灯笼、栈桥，中间压暗） | 9:16 |
| `market_route_laocheng_prompt.txt` | 老城菜行路线底图（青石厅、火腿，中间压暗） | 9:16 |
| `market_card_frame_prompt.txt` | 路线卡框（木框+纸面，入库前把纸面抠成透明窗口） | 3:4 |
| `market_cards_prompt.txt` | 巷口 12 格卡面缩略图集（4×3，四摊+事件+背面） | 1:1 |
| `market_cards_heyan_prompt.txt` | 河沿早市卡面图集（同格位，晨光河沿） | 1:1 |
| `market_cards_jiangbian_prompt.txt` | 江边渔市卡面图集（同格位，夜渔市） | 1:1 |
| `market_freebie_bundle_prompt.txt` | 白捡卡面重画：地上一个扎口布包，看不出内容（单格贴回图集第 6 格） | 3:4 |
| `npc_market_busts_prompt.txt` | 巷口事件半身像两连（张婶、收摊摊主），平灰底待抠 | 4:3 |
| `npc_heyan_busts_prompt.txt` | 河沿事件半身像两连（刘伯、早市摊嫂） | 4:3 |
| `npc_jiangbian_busts_prompt.txt` | 江边事件半身像两连（渔市阿珠、收网伙计） | 4:3 |
| `ui_event_gain_prompt.txt` | 白捡弹窗壳体（木框奶油纸，顶角白菜大蒜） | 3:4 |
| `ui_event_talk_prompt.txt` | 事件对话壳体（挂牌木框奶油纸，两侧灯笼） | 16:9 |
| `stall_rummage_*_prompt.txt` | 巷口四摊翻堆底 | 9:16 |
| `stall_pile_*_prompt.txt` | 巷口四摊遮挡堆（点堆抽取） | 1:1 |
| `stall_scenes_later_markets.txt` | 后四场按市场×摊位的翻堆底 / 遮挡堆 / 肉摊卡 | 9:16 / 1:1 / 3:4 |
| `shanwu_encounter_art_prompt.txt` | 山坞支线：小路/山洞底图、卡面、菌摊、石壁采集 | 9:16 / 3:4 |
| `heyan_encounter_art_prompt.txt` | 河沿支线：船坞底、藕摊/刘伯/河滩卡、采集底 | 9:16 / 3:4 |
| `jiangbian_encounter_art_prompt.txt` | 江边支线：夜栈/船舱底、鲜货筐/阿珠卡、采集底 | 9:16 / 3:4 |
| `laocheng_encounter_art_prompt.txt` | 老城支线：后厨/青石巷底、门/咸货/伙计卡 | 9:16 / 3:4 |
| `outing_curtain_prompt.txt` | 出门过场整图（一筐鲜货挡住屏幕） | 9:16 |
| `vehicles_prompt.txt` | 出门交通工具四件：布鞋 / 带筐自行车 / 带箱电动车 / 装筐小货车 | 1:1 2×2 |
| `vehicle_walk_prompt.txt` | 步行重画：脚朝外、分边摆好等着穿，鞋带自然 | 1:1 |
| `items_leaf_prompt.txt` 等 | 食材表 | 4:3 |
| `dishes_prompt.txt` | 三道熟菜共用风格 | 1:1 |
| `dish_stirfry_prompt.txt` / `dish_tomato_egg_prompt.txt` / `dish_garlic_shrimp_prompt.txt` | 装盘成品菜（旧三道） | 1:1 |
| `dish_egg_tofu_soup_prompt.txt` | 豆腐蛋花汤（替番茄蛋汤） | 1:1 |
| `dish_new_shared.txt` / `dish_batch01_prompt.txt` | 五十本里其余装盘菜 | 1:1 |
| `items_new_clean_prompt.txt` | 新食材干净态（按占格比例） | 随 w×h |
| `ui_fridge_panel_prompt.txt` | 冰箱形背包页（纯色腔体，顶栏/底栏留空） | 9:16 |
| `ui_fridge_btn_prompt.txt` | 冰箱页配套按钮板（奶油/砖红/胡桃） | 16:9 |
| `ui_cook_panel_prompt.txt` | 烹饪页砧板+空白油纸（与图鉴红本区分） | 9:16 |
| `kitchen_dex_book_prompt.txt` | 旧：厨房左墙悬挂图鉴书（已改 HUD 图标） | 1:1 |
| `hud_dex_prompt.txt` | 厨房左侧 HUD 图鉴图标（陶土书+奶油方块） | 1:1 |
| `dex_cat_icons_prompt.txt` | 图鉴分类方块 5×2（食材五类+菜品五组） | 1:1 |
| `dex_cat_fruit_prompt.txt` | 水果分类方块：西瓜+桃，不要西红柿 | 1:1 |
| `ui_dex_panel_prompt.txt` | 图鉴笔记本壳，空白纸面叠字 | 9:16 |
| `ui_cook_btn_prompt.txt` | 烹饪页专用大按钮（砖红布面，空心叠字） | 16:9 |
| `ui_recipe_paper_prompt.txt` | 解锁新菜弹窗油纸（木夹、空白纸心叠字） | 3:4 |
| `ui_basket_panel_prompt.txt` | 出门篮木箱壳：上托盘暂存、下箱井叠格子 | 9:16 |
