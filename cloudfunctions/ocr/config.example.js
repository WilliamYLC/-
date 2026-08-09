// 百度智能云 API Key / Secret Key（文字识别 + 图像识别：拍照识别文字 / 食物热量）
// 用法：复制本文件为同目录 config.js，把下面占位符替换成你自己的真实 Key。
// 获取：https://console.bce.baidu.com/ → 人工智能 → 文字识别（OCR）/ 图像识别（菜品识别，用于食物热量） → 创建应用
//       （可复用与 tts 同一组 Key）
module.exports = {
  baidu: {
    apiKey: 'YOUR_API_KEY',
    secretKey: 'YOUR_SECRET_KEY'
  }
};
