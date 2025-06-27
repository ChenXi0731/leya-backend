const sharp = require('sharp');
const axios = require('axios');
const path = require('path');
const fs = require('fs').promises; // 用於異步檔案操作
const { createCanvas, registerFont } = require('canvas');

// 註冊字體（確保字體檔案在部署時可用）
const fontPath = path.join(__dirname, 'SourceHanSerifTC-Bold.otf'); // 假設字體檔案在專案根目錄
let fontRegistered = false;

async function initializeFont() {
    if (fontRegistered) return true;
    try {
        await fs.access(fontPath); // 檢查檔案是否存在
        registerFont(fontPath, { family: 'MyCustomFont' });
        console.log(`✅ 外部字體 ${fontPath} 以 family 名稱 'MyCustomFont' 加載成功`);
        fontRegistered = true;
        return true;
    } catch (error) {
        console.warn('⚠️ 外部字體 SourceHanSerifTC-Bold.otf 不存在或加載失敗，將使用預設字體 Arial。錯誤:', error.message);
        fontRegistered = false; // 即使失敗也標記，避免重複嘗試
        return false;
    }
}

// 文字自動換行函數 (與您提供的一致)
function wrapText(text, maxCharsPerLine) {
    const words = text.split('');
    const lines = [];
    let currentLine = '';
    for (const char of words) {
        if (currentLine.length >= maxCharsPerLine) {
            lines.push(currentLine);
            currentLine = char;
        } else {
            currentLine += char;
        }
    }
    if (currentLine) {
        lines.push(currentLine);
    }
    return lines;
}

async function overlayTextOnImage(imageUrl, text, fontSizeRatio = 0.05) {
    console.log(`[imageProcessor] 開始處理圖片疊加。背景圖 URL: ${imageUrl}`);
    await initializeFont(); // 確保字體已初始化

    // 1. 下載圖片
    console.log(`[imageProcessor] 📥 正在下載背景圖片: ${imageUrl}`);
    let imageBuffer;
    try {
        const imageResponse = await axios.get(imageUrl, {
            responseType: 'arraybuffer',
            timeout: 15000 // 增加超時時間以防大圖下載緩慢
        });
        imageBuffer = Buffer.from(imageResponse.data);
    } catch (downloadError) {
        console.error(`[imageProcessor] ❌ 下載背景圖片失敗: ${downloadError.message}`);
        throw new Error(`無法下載背景圖片: ${downloadError.message}`);
    }

    // 2. 獲取圖片資訊
    const imageInfo = await sharp(imageBuffer).metadata();
    const { width, height } = imageInfo;
    if (!width || !height) {
        console.error(`[imageProcessor] ❌ 無法獲取圖片尺寸。寬: ${width}, 高: ${height}`);
        throw new Error('無法獲取有效的圖片尺寸');
    }
    console.log(`[imageProcessor] 📐 圖片尺寸: ${width}x${height}`);

    // 3. 計算字體大小和換行
    const fontSize = Math.floor(height * fontSizeRatio);
    // 根據經驗調整每行最大字元數的計算，中文和英文略有不同，這裡假設一個通用值
    const maxCharsPerLine = Math.floor(width / fontSize * 1.5); // 調整了係數
    const lines = wrapText(text, maxCharsPerLine);
    console.log(`[imageProcessor] 📝 文字行數: ${lines.length}, 每行最大字數: ${maxCharsPerLine}, 字體大小: ${fontSize}px`);

    // 4. 創建Canvas並繪製文字
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    const fontFamily = fontRegistered ? 'MyCustomFont' : 'Arial';
    ctx.font = `${fontSize}px ${fontFamily}`;
    ctx.fillStyle = 'white'; // 文字顏色
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const lineHeight = fontSize * 1.2; // 調整行高，使其更舒適
    const totalTextHeight = (lines.length - 1) * lineHeight; // 總文字塊高度
    const startY = (height - totalTextHeight) / 2; // 文字塊垂直居中

    lines.forEach((line, index) => {
        const y = startY + index * lineHeight;
        ctx.fillText(line, width / 2, y);
    });

    const textLayerBuffer = canvas.toBuffer('image/png');

    // 5. 創建半透明黑色遮罩 (可選，但通常效果更好)
    const overlayMaskBuffer = await sharp({
        create: {
            width,
            height,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0.4 } // 調整透明度 alpha (0.0 - 1.0)
        }
    }).png().toBuffer();

    // 6. 合成最終圖片
    console.log('[imageProcessor] 🖼️ 正在合成最終圖片...');
    const finalImageBuffer = await sharp(imageBuffer)
        .composite([
            { input: overlayMaskBuffer, blend: 'over' }, // 先疊加遮罩
            { input: textLayerBuffer, blend: 'over' }    // 再疊加文字層
        ])
        .png() // 輸出為 PNG 格式
        .toBuffer();

    console.log('[imageProcessor] ✅ 圖片疊加處理完成。');
    return finalImageBuffer;
}

module.exports = { overlayTextOnImage, initializeFont };