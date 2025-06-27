const axios = require('axios');

// 從環境變數讀取 GitHub 配置
// 這些應該在 .env 檔案中設定，並由 require('dotenv').config() 在 index.js 載入
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER; // 您的 GitHub 使用者名稱或組織名稱
const GITHUB_REPO = process.env.GITHUB_REPO;   // 您的倉庫名稱
const GITHUB_IMAGE_PATH = process.env.GITHUB_IMAGE_PATH || 'user_generated_images'; // 倉庫中儲存圖片的資料夾
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main'; // 您希望提交到的分支

/**
 * 上傳圖片 Buffer 到 GitHub 倉庫
 * @param {string} username - 用於構造檔案名稱或 commit message
 * @param {Buffer} imageBuffer - 包含圖片數據的 Buffer
 * @param {string} [filenamePrefix='chat_image'] - 檔案名稱的前綴
 * @returns {Promise<string|null>} - 成功時回傳圖片在 GitHub 上的 raw URL，失敗時回傳 null
 */
async function uploadToGithub(username, imageBuffer, filenamePrefix = 'chat_image') {
    if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
        console.error('[GitHubUploader] 錯誤：缺少必要的 GitHub 環境變數 (TOKEN, OWNER, REPO)。請檢查 .env 設定。');
        return null;
    }

    if (!imageBuffer || imageBuffer.length === 0) {
        console.error('[GitHubUploader] 錯誤：傳入的 imageBuffer 為空或無效。');
        return null;
    }

    // 1. 將圖片 Buffer 轉換為 Base64 字串
    const contentBase64 = imageBuffer.toString('base64');

    // 2. 構造檔案名稱和路徑
    // 確保檔案名稱的唯一性，可以加入時間戳或 UUID
    const timestamp = Date.now();
    const filename = `${filenamePrefix}_${username}_${timestamp}.png`;
    const filePathInRepo = `${GITHUB_IMAGE_PATH}/${filename}`.replace(/\/\//g, '/'); // 確保路徑分隔符為 '/'

    // 3. 構造 GitHub API URL
    const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePathInRepo}`;

    // 4. 構造請求 Body
    const commitMessage = `Upload chat image for user ${username} - ${filename}`;
    const requestBody = {
        message: commitMessage,
        content: contentBase64,
        branch: GITHUB_BRANCH
    };

    // 5. 構造請求 Headers
    const headers = {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
    };

    console.log(`[GitHubUploader] 準備上傳圖片到 GitHub: ${apiUrl}`);

    try {
        // 6. 發送請求到 GitHub API
        const response = await axios.put(apiUrl, requestBody, { headers });

        if (response.status === 201 || response.status === 200) { // 201 for new file, 200 for updated file
            const downloadUrl = response.data.content.download_url;
            console.log(`[GitHubUploader] ✅ 圖片成功上傳到 GitHub。檔案路徑: ${filePathInRepo}, 下載 URL: ${downloadUrl}`);
            return downloadUrl;
        } else {
            console.error(`[GitHubUploader] ❌ GitHub API 回應非預期狀態: ${response.status}`, response.data);
            return null;
        }
    } catch (error) {
        if (error.response) {
            // 請求已發出，但伺服器回應了錯誤狀態碼
            console.error(`[GitHubUploader] ❌ GitHub API 錯誤: ${error.response.status} - ${error.response.statusText}`, error.response.data);
        } else if (error.request) {
            // 請求已發出，但沒有收到回應
            console.error('[GitHubUploader] ❌ GitHub API 錯誤：沒有收到回應。', error.request);
        } else {
            // 設定請求時發生錯誤
            console.error('[GitHubUploader] ❌ GitHub API 請求設定錯誤:', error.message);
        }
        return null;
    }
}

module.exports = { uploadToGithub };