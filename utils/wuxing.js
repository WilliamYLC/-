// utils/wuxing.js —— 五行穿衣（基于 lunar-javascript 日柱干支）
//
// 算法：依据「日支」五行（地支），按五行相生环（木→火→土→金→水→木）循环固定映射五色等级：
//   吉     = 我生（next）  ——  我释放创造的能量
//   次吉   = 同我（self）  ——  与气场协调
//   平     = 克我（敌）    —— 需付出努力
//   较差   = 生我（印）    ——  耗精气以接受帮助
//   不宜   = 我克（财）    ——  耗我去追求
//
// 注：当日五行以「日支」为主（子亥水、寅卯木、巳午火、申酉金、辰戌丑未土），
// 日干五行作为辅助参考。每日数据随阳历日期变化，绝非随机生成。

const { Solar } = require('./lunar.js');

// 五行循环（按相生序）：木→火→土→金→水→木
const SHENG_NEXT = { '木': '火', '火': '土', '土': '金', '金': '水', '水': '木' };
// 五行被克（按相克序）：木←金、火←水、土←木、金←火、水←土
const KE_BY = { '木': '金', '火': '水', '土': '木', '金': '火', '水': '土' };
// 五行循环逆向（prev-prev = 生我者）
const SHENG_PREV2 = { '木': '水', '火': '木', '土': '火', '金': '土', '水': '金' };
// 五行"我克"（按相克序反向）：木克土、火克金、土克水、金克木、水克火
const WO_KE = { '木': '土', '火': '金', '土': '水', '金': '木', '水': '火' };

// 天干五行
const GAN_ELEMENT = {
  甲: '木', 乙: '木',
  丙: '火', 丁: '火',
  戊: '土', 己: '土',
  庚: '金', 辛: '金',
  壬: '水', 癸: '水'
};
const ZHI_ELEMENT = {
  子: '水', 亥: '水',
  寅: '木', 卯: '木',
  巳: '火', 午: '火',
  申: '金', 酉: '金',
  辰: '土', 戌: '土', 丑: '土', 未: '土'
};

// 五行 -> 颜色名数组（与原版链接 WUXING_COLORS 完全一致）
const WUXING_COLORS = {
  '金': ['白色', '银色', '杏色', '乳白色系'],
  '木': ['绿色', '青色', '翠色', '浅绿系'],
  '水': ['黑色', '蓝色', '灰色系'],
  '火': ['红色', '粉色', '橙色', '紫色', '花色系'],
  '土': ['黄色', '咖啡', '棕色', '卡其', '褐色系']
};
// 五行 -> 方块背景色（与原版链接 WUXING_BG 完全一致）
const WUXING_BG = {
  '金': '#E5E7EB', '木': '#10B981', '水': '#374151', '火': '#EF4444', '土': '#F59E0B'
};
// 五行 -> 标识 emoji（与原版链接 WUXING_EMOJI 一致：按五行元素取，而非按吉凶等级）
const WUXING_EMOJI = { '金': '⚪', '木': '🌿', '水': '🖤', '火': '❤️', '土': '🟡' };

// 等级配置（吉/次吉/平/较差/不宜）—— name/desc 与原版链接逐字一致
function buildRanking(selfEl) {
  return [
    {
      level: '吉',
      tag: '贵人色',
      element: SHENG_NEXT[selfEl],
      cls: 'lvl-best',
      desc: `与当日五行相生；为贵人色，即大环境生你的意思，易招贵人，易获扶助，异性缘会比平日增加。`
    },
    {
      level: '次吉',
      tag: '合作色',
      element: selfEl,
      cls: 'lvl-good',
      desc: `与当日五行相符，为幸运色，与他人合作利益时建议穿这类型颜色，如商务沟通、谈判等。`
    },
    {
      level: '平',
      tag: '奋斗进财色',
      element: KE_BY[selfEl],
      cls: 'lvl-mid',
      desc: `与当日五行相克，为奋斗进财色，你需要付出更多的努力，如果成功能得到较大的收获。`
    },
    {
      level: '较差',
      tag: '消耗色',
      element: SHENG_PREV2[selfEl],
      cls: 'lvl-bad',
      desc: `生当日五行，即你要去生大环境的意思，万事会较累，适合内心强大的人挑战下。`
    },
    {
      level: '不宜',
      tag: '不利色',
      element: WO_KE[selfEl],
      cls: 'lvl-worst',
      desc: `即大环境克你，办事成效差，易导致运势低下，且易出现事倍功半，徒劳无功之事。`
    }
  ];
}

function decorateRanking(ranking) {
  return ranking.map(row => {
    const list = WUXING_COLORS[row.element] || [];
    return Object.assign({}, row, {
      colors: list.join('、'),
      hex: WUXING_BG[row.element] || '#999',
      icon: WUXING_EMOJI[row.element] || '◇',
      elementChar: row.element
    });
  });
}

function buildDayInfo(date) {
  const s = Solar.fromDate(date);
  const l = s.getLunar();
  const dayGan = l.getDayGan();
  const dayZhi = l.getDayZhi();
  const ganEl = GAN_ELEMENT[dayGan];
  const zhiEl = ZHI_ELEMENT[dayZhi];
  return {
    dayGan, dayZhi,
    ganzhi: l.getDayInGanZhi(),
    nayin: l.getDayNaYin ? l.getDayNaYin() : '',
    mainEl: zhiEl,   // 当日五行以「日支」为准（与原版一致）；日干作辅助
    auxEl: ganEl
  };
}

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

// offset: 0=今天, 1=明天, ..., 6=第7天
function getWuxing(date, offset = 0) {
  const d = new Date(date);
  if (offset) d.setDate(d.getDate() + offset);
  const info = buildDayInfo(d);
  const ranking = decorateRanking(buildRanking(info.mainEl));
  return {
    date: formatDate(d),
    dateCN: `${d.getMonth() + 1}月${d.getDate()}日`,
    monthDay: `${d.getMonth() + 1}月${d.getDate()}日`,
    weekday: WEEKDAY_CN[d.getDay()],
    offset,
    gan: info.dayGan,
    zhi: info.dayZhi,
    ganzhi: info.ganzhi,
    nayin: info.nayin,
    element: info.mainEl,
    auxElement: info.auxEl,
    ranking,
    detail: `日柱 ${info.ganzhi} · 纳音 ${info.nayin} · 当日五行属「${info.mainEl}」。`
  };
}

module.exports = { getWuxing };
