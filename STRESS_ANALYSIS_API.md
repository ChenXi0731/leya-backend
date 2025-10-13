# 壓力來源分析功能 - API 文件

## 概述
此功能使用 OpenAI 分析用戶的聊天記錄（chat_history）和心情日記（mood_history），自動識別壓力來源並生成結構化的分析記錄，存儲在 `emotion_analysis` 資料表中。

## 資料表結構

### emotion_analysis 表
```sql
CREATE TABLE emotion_analysis (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    category VARCHAR(50) NOT NULL,      -- 來源類型：學業、人際、家庭、財務、健康、未來等
    source VARCHAR(200) NOT NULL,       -- 來源細項：具體的壓力來源
    impact VARCHAR(200),                -- 影響面向：睡眠、時間管理、情緒波動等
    emotion VARCHAR(50),                -- 主要感受：焦慮、壓迫、憤怒、自責等
    note TEXT,                          -- 詳細說明
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

## API 端點

### 1. 執行壓力來源分析
**POST** `/analyze-stress`

分析用戶的聊天與心情記錄，使用 OpenAI 生成壓力來源分析。

#### 請求體
```json
{
  "username": "user123"
}
```

#### 回應
```json
{
  "success": true,
  "message": "成功分析並儲存 5 條壓力來源記錄",
  "records": [
    {
      "id": 1,
      "username": "user123",
      "category": "學業",
      "source": "考試壓力",
      "impact": "睡眠",
      "emotion": "焦慮",
      "note": "期末考臨近，準備不足造成睡眠品質下降",
      "created_at": "2025-01-13T10:30:00Z"
    }
  ],
  "count": 5
}
```

#### 錯誤回應
- `400`: 缺少必要欄位
- `404`: 該用戶沒有足夠的記錄可供分析
- `500`: 伺服器錯誤
- `502`: OpenAI API 呼叫失敗

---

### 2. 取得用戶的壓力分析記錄
**GET** `/emotion-analysis?username={username}`

查詢特定用戶的所有壓力來源分析記錄。

#### 查詢參數
- `username` (必填): 用戶名稱

#### 回應
```json
{
  "success": true,
  "records": [
    {
      "id": 1,
      "username": "user123",
      "category": "學業",
      "source": "考試壓力",
      "impact": "睡眠",
      "emotion": "焦慮",
      "note": "期末考臨近，準備不足造成睡眠品質下降",
      "created_at": "2025-01-13T10:30:00Z"
    }
  ],
  "count": 1
}
```

---

### 3. 刪除特定分析記錄
**DELETE** `/emotion-analysis/:id`

刪除指定 ID 的壓力分析記錄（需要驗證用戶權限）。

#### 路徑參數
- `id`: 記錄的 ID

#### 請求體
```json
{
  "username": "user123"
}
```

#### 回應
```json
{
  "success": true,
  "message": "刪除成功",
  "record": {
    "id": 1,
    "username": "user123",
    "category": "學業",
    "source": "考試壓力",
    "impact": "睡眠",
    "emotion": "焦慮",
    "note": "期末考臨近，準備不足造成睡眠品質下降",
    "created_at": "2025-01-13T10:30:00Z"
  }
}
```

## 前端使用方式

### StressMindMap 組件
壓力來源心智圖組件會自動：
1. 載入用戶的壓力分析記錄
2. 提供「AI 壓力分析」按鈕來觸發新的分析
3. 以心智圖視覺化方式呈現壓力來源

#### 使用範例
```jsx
import StressMindMap from './StressMapContent';

function MyComponent() {
  const username = 'user123';
  
  return (
    <StressMindMap 
      username={username}
      height={600}
      maxDepth={2}
    />
  );
}
```

#### Props
- `username` (string): 用戶名稱（必填）
- `height` (number): 心智圖高度，預設 600
- `maxDepth` (number): 顯示的最大層級深度，預設無限制
- `data` (array): 可選的自訂資料，預設會從 API 載入

## 工作流程

1. **用戶點擊「AI 壓力分析」按鈕**
   - 前端發送 POST 請求到 `/analyze-stress`

2. **後端處理**
   - 從 `chat_history` 取得最近 50 筆聊天記錄
   - 從 `mood_history` 取得最近 30 筆心情日記
   - 組合資料並發送給 OpenAI API
   - OpenAI 分析並回傳 JSON 格式的壓力來源記錄
   - 將記錄存入 `emotion_analysis` 資料表

3. **前端顯示**
   - 接收分析結果並更新心智圖
   - 顯示成功訊息和記錄數量

## 環境變數

確保在 `.env` 檔案中設定：
```env
OPENAI_API_KEY=your_openai_api_key_here
```

## 資料隱私與安全

- 所有分析記錄僅與用戶的 `username` 關聯
- 用戶只能查看和刪除自己的記錄
- OpenAI API 呼叫時不會儲存用戶的原始對話內容

## 限制

- 分析需要用戶有至少一筆聊天記錄或心情日記
- OpenAI API 有使用配額限制
- 每次分析會生成 3-8 條壓力來源記錄

## 故障排除

### 問題：分析失敗，提示「該用戶沒有足夠的記錄可供分析」
**解決方案**: 確保用戶至少有一筆聊天記錄或心情日記

### 問題：顯示「OpenAI 呼叫失敗」
**解決方案**: 
1. 檢查 OPENAI_API_KEY 是否正確設定
2. 確認 OpenAI API 配額是否足夠
3. 檢查網路連線狀態

### 問題：分析結果為空
**解決方案**: 
1. 檢查資料庫連線
2. 確認 emotion_analysis 資料表已正確建立
3. 查看後端日誌以獲取詳細錯誤訊息

## 未來改進方向

- [ ] 支援批量分析多個用戶
- [ ] 提供分析結果的匯出功能（PDF/CSV）
- [ ] 新增時間範圍篩選
- [ ] 提供壓力趨勢分析圖表
- [ ] 新增手動編輯分析記錄的功能
- [ ] 實作更細緻的權限控制
