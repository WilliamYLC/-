// utils/wuxing.js —— 五行穿衣（基于 lunar-javascript 日柱干支）
//
// 算法：依据日干五行，按五行相生环（木→火→土→金→水→木）循环固定映射五色等级：
//   吉     = 我生（next）  ——  我释放创造的能量
//   次吉   = 同我（self）  ——  与气场协调
//   平     = 克我（敌）    —— 需付出努力
//   较差   = 生我（印）    ——  耗精气以接受帮助
//   不宜   = 我克（财）    ——  耗我去追求
//
// 注：日干五行按天干决定（甲乙木、丙丁火、戊己土、庚辛金、壬癸水），
// 日支五行作为辅助参考。每日数据随阳历日期变化，绝非随机生成。

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

// 五行 -> 色名表 + 代表色（用于显示色块）
const ELEMENT_PALETTE = {
  木: { name: '绿色系', list: ['绿色', '青色', '翠色', '浅绿系'], hex: ['#2ECC71', '#27AE60', '#16A085', '#1ABC9C'] },
  火: { name: '红色系', list: ['红色', '粉色', '橙色', '紫色', '花色系'], hex: ['#E74C3C', '#FF6B9D', '#FF8C42', '#9B59B6', '#FF4757'] },
  土: { name: '黄色系', list: ['黄色', '咖啡色', '棕色', '卡其', '褐色系'], hex: ['#F1C40F', '#A0522D', '#8B4513', '#DEB887', '#D4A017'] },
  金: { name: '白色系', list: ['白色', '银色', '杏色', '乳白色系'], hex: ['#FFFFFF', '#C0C0C0', '#FFE4B5', '#FAF0E6', '#FFD700'] },
  水: { name: '黑色系', list: ['黑色', '蓝色', '灰色系'], hex: ['#2C3E50', '#3498DB', '#5D6D7E', '#95A5A6', '#1F2D3D'] }
};

// 五级 emoji 图标（避免白底白字消失问题，每级一个有辨识度的图案）
const LEVEL_ICON = {
  '吉': '❤️',   // 红心（红/火）
  '次吉': '🌿',  // 树叶（绿/木）
  '平': '⚪',   // 白圆（金/白）
  '较差': '🖤',  // 黑心（水/黑）
  '不宜': '🟠'   // 金橙球（土/黄）
};

// 等级配置（吉/次吉/平/较差/不宜）
function buildRanking(selfEl) {
  return [
    {
      level: '吉',
      tag: '贵人色',
      element: SHENG_NEXT[selfEl],
      cls: 'lvl-best',
      desc: `与当日五行相生，即大环境生你的意思，易招贵人，易获扶助，异性缘会比平日增加。`
    },
    {
      level: '次吉',
      tag: '合作色',
      element: selfEl,
      cls: 'lvl-good',
      desc: `与当日五行相符，为幸运色，与他人合作利益时建议穿这类颜色，如商务沟通、谈判等。`
    },
    {
      level: '平',
      tag: '备选色',
      element: KE_BY[selfEl],
      cls: 'lvl-mid',
      desc: `与当日五行相克，为备选进取色，你需要付出更多的努力，如果成功能得到较大的收获。`
    },
    {
      level: '较差',
      tag: '消耗色',
      element: SHENG_PREV2[selfEl],
      cls: 'lvl-bad',
      desc: `生当日五行，即你要去生大环境的意思，万事会比较累，适合内心强大的人接受挑战。`
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
    const pal = ELEMENT_PALETTE[row.element] || {};
    return Object.assign({}, row, {
      colors: pal.list ? pal.list.join('、') : '',
      hex: pal.hex ? pal.hex[0] : '#999',
      icon: LEVEL_ICON[row.level] || '◇',
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
    mainEl: ganEl,
    auxEl: zhiEl
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
