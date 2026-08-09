// utils/date.js —— 日期辅助
function today() {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

// 友好的星期显示
function weekday() {
  const names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return names[new Date().getDay()];
}

// 中文日期徽章：7月27日 · 周一
function dateCN() {
  const d = new Date();
  return `${d.getMonth() + 1}月${d.getDate()}日 · ${weekday()}`;
}

module.exports = { today, weekday, dateCN };
