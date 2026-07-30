import { C } from '../config';
import type { RoomMeta, RoomType } from './types';

/** Room presentation table — labels, flavour, icon key and node accent colour. */
export const ROOM_META: Record<RoomType, RoomMeta> = {
  monster: {
    label: '遭遇战',
    desc: '寻常敌军，刀兵相见。',
    icon: 'icon-monster',
    accent: C.paperDim,
  },
  elite: {
    label: '精锐',
    desc: '敌之骁将，胜之必有厚赏。',
    icon: 'icon-elite',
    accent: C.cinnabar,
  },
  event: {
    label: '奇遇',
    desc: '吉凶未卜，天意难测。',
    icon: 'icon-event',
    accent: C.jade,
  },
  shop: {
    label: '商旅',
    desc: '以金易物，各取所需。',
    icon: 'icon-shop',
    accent: C.gold,
  },
  rest: {
    label: '营帐',
    desc: '休整疗伤，或参悟兵法。',
    icon: 'icon-rest',
    accent: 0xd98b3a,
  },
  treasure: {
    label: '宝藏',
    desc: '前朝遗宝，无主之物。',
    icon: 'icon-treasure',
    accent: C.goldBright,
  },
  boss: {
    label: '关隘主将',
    desc: '一夫当关。此战不可退。',
    icon: 'icon-boss',
    accent: C.cinnabarBright,
  },
};
