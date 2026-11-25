// ─────────────────────────────────────────────────────────────────────────────
// 微信端广告单元 ID（WeChat Mini Game）
// ─────────────────────────────────────────────────────────────────────────────

// 已独立接入的激励视频广告单元
const WX_BASKET = 'adunit-fde283ee5c313801';
const WX_STAMINA = 'adunit-5029a65d9338bf20';
const WX_SPECIAL = 'adunit-d17e790a3032b27a';
const WX_DUSK_FLASHLIGHT = 'adunit-c716fa86fcfc0f51';
const WX_GACHA_BOX = 'adunit-071f43ffabdbfa6f';
const WX_CHEF_BUFF = 'adunit-a15a4083328545e7';
const WX_NEIGHBOR_ORDER = 'adunit-5631ddd46fe29b86';
const WX_DAILY_MENU = 'adunit-8426642edee27748';
const WX_PICKLE_BOOST = 'adunit-77fdf93257f7ec57';
const WX_CAT_TREAT = 'adunit-af2459538ecccca4';

/**
 * 微信端待拆分独立激励视频预留常量：
 * - 未在微信公众平台新建前默认指向旧可用 ID，确保线上 100% 正常播放；
 * - 新建广告位后，直接将右侧变量替换为对应 'adunit-xxxxxxxxxxxxxxxx' 字符串即可生效。
 */
const WX_STALL_FAVOR = WX_BASKET;          // TODO(新建替换): 赶集摊位互动（老杆秤免单+2件 / 神秘盲袋全收）
const WX_UNPACK_VIP = WX_BASKET;           // TODO(新建替换): 满柜结算街坊 1.5 倍高价包圆余菜
const WX_GACHA_TOPUP = WX_GACHA_BOX;       // TODO(新建替换): 寻味抽签差 1 券补齐开匣（与每日免费一匣拆分）
const WX_ORDER_REFRESH = WX_NEIGHBOR_ORDER; // TODO(新建替换): 街坊点单免冷却立即换单（与双倍交菜拆分）

/**
 * 微信端回家插屏广告位预留：
 * - 当前留空自动静默跳过；在微信后台新建插屏广告位后填入 'adunit-xxxxxxxxxxxxxxxx' 即自动开启。
 */
const WX_INTERSTITIAL_GO_HOME = '';

// ─────────────────────────────────────────────────────────────────────────────
// 抖音端广告单元 ID（Douyin Mini Game）
// ─────────────────────────────────────────────────────────────────────────────

// 已有的 3 个基础激励视频广告单元
const DY_BASKET = '10ggdbfh2701d4bmge';
const DY_STAMINA = 'ge896cb3h3d9bpacnp';
const DY_SPECIAL = 'f52322inh00d036hji';

/**
 * 抖音端待新建拆分的 11 个独立激励视频预留常量：
 * - 目前默认复用上方 3 个旧可用 ID，不影响线上播放；
 * - 在抖音开放平台新建对应激励视频广告位后，逐行替换为新广告位 ID 字符串即可。
 */
const DY_DUSK_FLASHLIGHT = DY_BASKET; // TODO(新建替换): 赶集天黑借手电筒 +3 步
const DY_STALL_FAVOR = DY_BASKET;     // TODO(新建替换): 赶集摊位互动（老杆秤免单+2件 / 神秘盲袋全收）
const DY_UNPACK_VIP = DY_BASKET;      // TODO(新建替换): 满柜结算街坊 1.5 倍高价包圆余菜
const DY_GACHA_FREE = DY_SPECIAL;     // TODO(新建替换): 寻味抽签每日免费开一匣
const DY_GACHA_TOPUP = DY_SPECIAL;    // TODO(新建替换): 寻味抽签差 1 券补齐开匣
const DY_CHEF_BUFF = DY_STAMINA;      // TODO(新建替换): 烟火灶台点燃大厨旺火（经验加成+概率双份）
const DY_ORDER_DOUBLE = DY_STAMINA;   // TODO(新建替换): 街坊点单双倍交菜领谢礼
const DY_ORDER_REFRESH = DY_BASKET;   // TODO(新建替换): 街坊点单免冷却立即换单
const DY_DAILY_EXTRA = DY_SPECIAL;    // TODO(新建替换): 今日菜单加开晚市再赠券
const DY_PICKLE_BOOST = DY_STAMINA;   // TODO(新建替换): 老坛腌制坊催熟完成+产量加1
const DY_CAT_TREAT = DY_SPECIAL;      // TODO(新建替换): 阿橘小窝喂鲜鱼罐头 / 巡街摇铃唤回

/** 抖音端回家插屏广告单元（从菜场/选集市页返回厨房时触发） */
export const DOUYIN_INTERSTITIAL_AD_UNIT = '426pdmecklv18c4k1l';

/**
 * 激励视频广告位，按宿主与 14 个业务场景严格一一映射。
 */
export const REWARDED_AD_UNITS_BY_PLATFORM = {
  wechat: {
    basket: WX_BASKET,
    stamina: WX_STAMINA,
    special: WX_SPECIAL,
    dusk_steps: WX_DUSK_FLASHLIGHT,
    gacha_free: WX_GACHA_BOX,
    gacha_topup: WX_GACHA_TOPUP,
    chef_buff: WX_CHEF_BUFF,
    order_double: WX_NEIGHBOR_ORDER,
    order_refresh: WX_ORDER_REFRESH,
    daily_extra: WX_DAILY_MENU,
    pickle_boost: WX_PICKLE_BOOST,
    cat_treat: WX_CAT_TREAT,
    stall_favor: WX_STALL_FAVOR,
    unpack_vip: WX_UNPACK_VIP,
  },
  douyin: {
    basket: DY_BASKET,
    stamina: DY_STAMINA,
    special: DY_SPECIAL,
    dusk_steps: DY_DUSK_FLASHLIGHT,
    gacha_free: DY_GACHA_FREE,
    gacha_topup: DY_GACHA_TOPUP,
    chef_buff: DY_CHEF_BUFF,
    order_double: DY_ORDER_DOUBLE,
    order_refresh: DY_ORDER_REFRESH,
    daily_extra: DY_DAILY_EXTRA,
    pickle_boost: DY_PICKLE_BOOST,
    cat_treat: DY_CAT_TREAT,
    stall_favor: DY_STALL_FAVOR,
    unpack_vip: DY_UNPACK_VIP,
  },
} as const;

/**
 * 插屏广告位，按宿主区分（微信留空时自动跳过，填号即生效）。
 */
export const INTERSTITIAL_AD_UNITS_BY_PLATFORM = {
  wechat: WX_INTERSTITIAL_GO_HOME,
  douyin: DOUYIN_INTERSTITIAL_AD_UNIT,
} as const;

export type RewardedAdScene = keyof typeof REWARDED_AD_UNITS_BY_PLATFORM.wechat;
