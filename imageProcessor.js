const sharp = require('sharp');
const axios = require('axios');
const path = require('path');
const fs = require('fs').promises; // 用於異步檔案操作
const { createCanvas, registerFont } = require('canvas');

// 註冊字體（確保字體檔案在部署時可用）
const fontPath = path.join(__dirname, 'ChenYuluoyan-Thin-Monospaced.ttf'); // 假設字體檔案在專案根目錄
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
        console.warn('⚠️ 外部字體 ChenYuluoyan-Thin-Monospaced.ttf 不存在或加載失敗，將使用預設字體 Arial。錯誤:', error.message);
        fontRegistered = false; // 即使失敗也標記，避免重複嘗試
        return false;
    }
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
    let { width, height } = imageInfo;
    if (!width || !height) {
        console.error(`[imageProcessor] ❌ 無法獲取圖片尺寸。寬: ${width}, 高: ${height}`);
        throw new Error('無法獲取有效的圖片尺寸');
    }
    console.log(`[imageProcessor] 📐 圖片尺寸: ${width}x${height}`);

    // 2.5. 縮放圖片（最大邊長不超過 1080px）
    const maxSide = 1080;
    let scale = 1;
    if (width > maxSide || height > maxSide) {
        scale = Math.min(maxSide / width, maxSide / height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
        imageBuffer = await sharp(imageBuffer).resize(width, height).toBuffer();
        console.log(`[imageProcessor] 🔄 已縮放圖片至: ${width}x${height}`);
    }

    // 3. 計算字體大小
    const fontSize = Math.floor(height * fontSizeRatio);

    // 4. 創建Canvas並繪製文字
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    const fontFamily = fontRegistered ? 'MyCustomFont' : 'Arial';
    ctx.font = `${fontSize}px ${fontFamily}`;
    ctx.fillStyle = 'white'; // 文字顏色
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 新的根據像素寬度自動換行函數
    function wrapTextByWidth(ctx, text, maxWidth) {
        const lines = [];
        let line = '';
        for (let i = 0; i < text.length; i++) {
            const testLine = line + text[i];
            const metrics = ctx.measureText(testLine);
            if (metrics.width > maxWidth && line !== '') {
                lines.push(line);
                line = text[i];
            } else {
                line = testLine;
            }
        }
        if (line) lines.push(line);
        return lines;
    }

    const maxTextWidth = width * 0.9; // 讓文字左右有留白
    const lines = wrapTextByWidth(ctx, text, maxTextWidth);
    console.log(`[imageProcessor] 📝 文字行數: ${lines.length}, maxTextWidth: ${maxTextWidth}, 字體大小: ${fontSize}px`);

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
    let finalImageBuffer = await sharp(imageBuffer)
        .composite([
            { input: overlayMaskBuffer, blend: 'over' }, // 先疊加遮罩
            { input: textLayerBuffer, blend: 'over' }    // 再疊加文字層
        ])
        .png({ quality: 80, compressionLevel: 9 }) // 輸出為 PNG 格式，壓縮品質
        .toBuffer();

    // 7. 若仍超過 1MB，進一步壓縮（轉成 JPEG 並調整品質）
    if (finalImageBuffer.length > 1024 * 1024) {
        console.log(`[imageProcessor] ⚠️ PNG 超過 1MB，嘗試轉為 JPEG 並壓縮...`);
        finalImageBuffer = await sharp(finalImageBuffer)
            .jpeg({ quality: 80 })
            .toBuffer();
        // 若還是超過 1MB，再降品質
        let quality = 70;
        while (finalImageBuffer.length > 1024 * 1024 && quality >= 40) {
            finalImageBuffer = await sharp(finalImageBuffer)
                .jpeg({ quality })
                .toBuffer();
            quality -= 10;
        }
        console.log(`[imageProcessor] JPEG 壓縮後大小: ${(finalImageBuffer.length / 1024).toFixed(1)} KB`);
    }

    console.log('[imageProcessor] ✅ 圖片疊加處理完成。');
    return finalImageBuffer;
}

module.exports = { overlayTextOnImage, initializeFont };