# 壓力來源分析功能實作總結

## 📋 專案概述
已成功實作壓力來源分析功能，該功能會自動分析用戶的聊天記錄（chat_history）和心情日記（mood_history），使用 OpenAI 識別壓力來源，並以心智圖視覺化方式呈現。

## ✅ 已完成的工作

### 1. 資料庫設計
**檔案**: `create_emotion_analysis_table.sql`

建立 `emotion_analysis` 資料表，包含以下欄位：
- `id`: 主鍵（自動遞增）
- `username`: 使用者名稱
- `category`: 來源類型（學業、人際、家庭、財務、健康、未來等）
- `source`: 來源細項（具體的壓力來源）
- `impact`: 影響面向（睡眠、時間管理、情緒波動等）
- `emotion`: 主要感受（焦慮、壓迫、憤怒、自責等）
- `note`: 詳細說明
- `created_at`: 建立時間

包含三個索引以提升查詢效能：
- `idx_emotion_analysis_username`
- `idx_emotion_analysis_category`
- `idx_emotion_analysis_created_at`

### 2. 後端 API 實作
**檔案**: `leya-backend/index.js`

新增三個 API 端點：

#### a) POST `/analyze-stress`
- 從資料庫查詢用戶的聊天記錄（最近 50 筆）
- 從資料庫查詢用戶的心情記錄（最近 30 筆）
- 組合資料並發送給 OpenAI API 進行分析
- 將分析結果（3-8 條記錄）儲存到資料庫
- 回傳分析結果和記錄數量

#### b) GET `/emotion-analysis?username={username}`
- 查詢特定用戶的所有壓力分析記錄
- 依時間倒序排列
- 回傳記錄陣列和總數

#### c) DELETE `/emotion-analysis/:id`
- 刪除指定 ID 的壓力分析記錄
- 驗證用戶權限（僅能刪除自己的記錄）
- 回傳刪除的記錄資訊

### 3. 前端組件更新

#### a) `StressMapContent.jsx`
**主要變更**：
- 新增 `useState` 管理分析資料、載入狀態、錯誤狀態
- 新增 `useEffect` 在組件載入時自動取得用戶的分析記錄
- 新增 `handleAnalyzeStress` 函數來觸發 AI 分析
- 新增「AI 壓力分析」按鈕
- 新增狀態指示器（載入中、錯誤、記錄數量）
- 支援 `username` prop 來識別用戶

**新增功能**：
- 自動從 API 載入分析記錄
- 點擊按鈕觸發新的分析
- 顯示分析進度和結果
- 錯誤處理和提示

#### b) `StressMindMap.jsx`
**主要變更**：
- 接收 `userInfo` prop
- 提取 `username` 並傳遞給 `StressMapContent`
- 新增未登入提示訊息
- 移除原本的「重新分析」按鈕（功能已整合到 StressMapContent）

#### c) `InfoCard.jsx`
**主要變更**：
- 傳遞 `username` prop 給 `StressMindMap` 組件
- 使組件能在首頁卡片中正確顯示用戶的分析資料

### 4. 文件撰寫

#### a) `STRESS_ANALYSIS_API.md`
完整的 API 文件，包含：
- 資料表結構說明
- 三個 API 端點的詳細文件
- 請求和回應範例
- 前端使用方式
- 工作流程說明
- 環境變數設定
- 故障排除指南

#### b) `STRESS_ANALYSIS_GUIDE.md`
用戶使用指南，包含：
- 功能簡介
- 快速開始步驟
- 使用流程說明
- 心智圖操作說明
- 分析結果解釋
- 常見問題 (FAQ)
- 故障排除
- 技術細節

#### c) `test_stress_analysis.js`
API 測試腳本，包含：
- 測試壓力分析功能
- 測試取得分析記錄
- 測試刪除記錄（可選）
- 完整的測試流程和輸出

## 📁 修改的檔案清單

### 後端 (leya-backend)
```
leya-backend/
├── index.js                          ✏️ 已修改（新增 3 個 API 端點）
├── create_emotion_analysis_table.sql  ✨ 新增
├── STRESS_ANALYSIS_API.md            ✨ 新增
├── STRESS_ANALYSIS_GUIDE.md          ✨ 新增
└── test_stress_analysis.js           ✨ 新增
```

### 前端 (leyatalks.github.io)
```
leyatalks.github.io/
└── src/
    └── AP/
        └── app-components/
            ├── StressMapContent.jsx         ✏️ 已修改（新增 API 整合）
            ├── StressMindMap.jsx            ✏️ 已修改（傳遞 username）
            └── MainPageComponents/
                └── InfoCard.jsx             ✏️ 已修改（傳遞 username）
```

## 🔧 環境需求

### 後端
- Node.js (已安裝)
- PostgreSQL 資料庫
- OpenAI API Key

### 前端
- React (已安裝)
- D3.js (已安裝)
- Vite (已安裝)

## 📝 部署步驟

### 1. 資料庫設定
```sql
-- 在 PostgreSQL 中執行
psql -U a111070036 -h a111070036pg.postgres.database.azure.com -d leya_talks -f create_emotion_analysis_table.sql
```

### 2. 環境變數
確保 `.env` 包含：
```env
OPENAI_API_KEY=your_openai_api_key_here
```

### 3. 後端部署
```bash
cd leya-backend
npm install
# 測試
node test_stress_analysis.js
# 部署到 Vercel（如果需要）
vercel --prod
```

### 4. 前端部署
```bash
cd leyatalks.github.io
npm install
npm run build
# 部署到 GitHub Pages（如果需要）
git add .
git commit -m "Add stress analysis feature"
git push
```

## 🧪 測試建議

### 功能測試
1. ✅ 建立測試用戶並登入
2. ✅ 新增幾筆聊天記錄
3. ✅ 新增幾筆心情日記
4. ✅ 執行壓力分析
5. ✅ 查看心智圖是否正確顯示
6. ✅ 測試重複分析是否正常
7. ✅ 測試未登入狀態的提示

### API 測試
```bash
node test_stress_analysis.js
```

## 🚀 功能特色

1. **AI 驅動分析**: 使用 OpenAI GPT-4o-mini 進行智能分析
2. **自動化處理**: 自動從聊天和心情記錄中提取壓力來源
3. **視覺化呈現**: 以心智圖方式直觀展示分析結果
4. **互動式操作**: 支援縮放、拖曳、懸停查看詳情
5. **實時更新**: 點擊按鈕即可重新分析最新記錄
6. **錯誤處理**: 完善的錯誤提示和狀態指示
7. **權限控制**: 用戶只能查看和操作自己的記錄

## 🔒 安全性考量

- ✅ 用戶資料隔離（透過 username 過濾）
- ✅ API 權限驗證（刪除時檢查 username）
- ✅ SQL 注入防護（使用參數化查詢）
- ✅ 錯誤處理（不暴露敏感資訊）

## 📊 效能優化

- ✅ 資料庫索引（username, category, created_at）
- ✅ 限制查詢筆數（聊天 50 筆、心情 30 筆）
- ✅ 前端狀態管理（避免不必要的重新渲染）
- ✅ 延遲載入（Suspense）

## 🎯 未來改進方向

1. **前端刪除功能**: 讓用戶可以刪除不需要的分析記錄
2. **時間範圍篩選**: 支援按時間範圍查看分析
3. **趨勢分析**: 顯示壓力來源的時間趨勢圖
4. **匯出功能**: 支援 PDF/CSV 匯出
5. **批次分析**: 支援管理員批次分析多個用戶
6. **更細緻的分類**: 增加更多壓力來源類別
7. **個人化建議**: 根據分析結果提供個人化的減壓建議
8. **分享功能**: 讓用戶可以選擇性分享分析結果

## 💡 使用建議

1. **累積足夠資料**: 建議至少 5-10 筆記錄才執行分析
2. **定期更新**: 每週或每兩週重新分析以追蹤變化
3. **詳細記錄**: 在聊天和日記中詳細描述感受以提高分析準確度
4. **結合專業**: 分析結果僅供參考，必要時請尋求專業協助

## 📞 支援與維護

- **技術問題**: 查看 `STRESS_ANALYSIS_API.md` 的故障排除章節
- **使用問題**: 查看 `STRESS_ANALYSIS_GUIDE.md` 的常見問題
- **Bug 回報**: 在 GitHub 提交 Issue
- **功能建議**: 在 GitHub 提交 Feature Request

## ✨ 致謝

感謝使用本功能！希望能幫助用戶更好地了解和管理壓力。
