# jiancai-rosa

捡菜市集：微信 / 抖音小游戏。收摊翻出好食材，用有限菜篮带走，回家卖掉或做菜。

```
npm install
npm run build
```

`npm run build` 同时组装 `build/wechat/` 和 `build/douyin/`。只要一端时用 `npm run build:wechat` 或 `npm run build:douyin`。

微信开发者工具打开本仓库根目录（`miniprogramRoot` 指向 `build/wechat/`）。抖音开发者工具打开 `build/douyin/`。不要直接打开 `minigame/`。

抖音 appid 在 `platform/douyin/project.config.json`。侧边栏复访和添加到桌面在厨房左侧「福利」。抖音激励视频和回家插屏已接上。云函数 `jiancai-api` 已配抖音登录。CDN 域名 `726f-rosa-env-d7grf78r5dbd37323-1414200063.tcb.qcloud.la` 要加进抖音下载合法域名。
