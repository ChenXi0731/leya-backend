# 壓力分析記錄管理更新說明

## 變更概述
現在系統會保留所有歷史分析記錄，但預設只顯示最新一次的分析結果。

## 主要變更

### 1. 保存機制改進
- ✅ **保留所有歷史記錄**：每次分析都會新增記錄，不會刪除舊資料
- ✅ **批次時間戳**：同一次分析的所有記錄使用相同的時間戳
- ✅ **完整歷史追蹤**：可以查看用戶過去的所有分析結果

### 2. API 端點更新

#### GET `/emotion-analysis` - 取得最新分析（預設）
**功能**：只返回用戶最新一次的分析結果

**回應範例**：
```json
{
  "success": true,
  "records": [
    {
      "id": 15,
      "username": "user123",
      "category": "學業",
      "source": "考試壓力",
      "impact": "睡眠",
      "emotion": "焦慮",
      "note": "期末考臨近導致睡眠不足",
      "created_at": "2025-01-13T15:30:00Z"
    }
  ],
  "count": 5,
  "analysisDate": "2025-01-13T15:30:00Z"
}
```

#### GET `/emotion-analysis/history` - 取得所有歷史記錄（新增）
**功能**：返回用戶所有的歷史分析記錄，按時間分組

**查詢參數**：
- `username` (必填): 用戶名稱

**回應範例**：
```json
{
  "success": true,
  "history": [
    {
      "analysisDate": "2025-01-13T15:30:00Z",
      "records": [
        {
          "id": 15,
          "category": "學業",
          "source": "考試壓力",
          ...
        }
      ],
      "count": 5
    },
    {
      "analysisDate": "2025-01-10T10:20:00Z",
      "records": [...],
      "count": 4
    }
  ],
  "totalAnalyses": 2
}
```

## 工作流程

### 執行新分析
1. 用戶點擊「AI 壓力分析」
2. 系統從資料庫查詢最新的聊天和心情記錄
3. OpenAI 分析並回傳結果
4. **所有記錄使用相同的時間戳儲存**
5. 前端自動顯示最新分析結果

### 查看歷史記錄
1. 用戶可以查看過去所有的分析記錄
2. 每次分析都會完整保存
3. 可以比較不同時期的壓力來源變化

## 資料庫結構

### emotion_analysis 表
```sql
CREATE TABLE emotion_analysis (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    category VARCHAR(50) NOT NULL,
    source VARCHAR(200) NOT NULL,
    impact VARCHAR(200),
    emotion VARCHAR(50),
    note TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

**重要說明**：
- 同一次分析的所有記錄會有**完全相同的 `created_at` 時間戳**
- 這樣可以輕鬆識別哪些記錄屬於同一次分析
- 不同次分析會有不同的時間戳

## 前端整合建議

### 顯示最新分析（現有功能）
```javascript
// 已經自動實作，不需修改
const response = await fetch(`${API_BASE_URL}/emotion-analysis?username=${username}`);
const data = await response.json();
// data.records 包含最新一次的分析記錄
```

### 顯示歷史記錄（新功能，可選）
```javascript
// 取得所有歷史記錄
const response = await fetch(`${API_BASE_URL}/emotion-analysis/history?username=${username}`);
const data = await response.json();

// 顯示每次分析的日期和記錄數
data.history.forEach(analysis => {
  console.log(`分析日期: ${analysis.analysisDate}`);
  console.log(`記錄數量: ${analysis.count}`);
  console.log(`記錄:`, analysis.records);
});
```

## 使用場景

### 場景 1: 用戶第一次分析
1. 系統創建 5 條記錄，時間戳 `2025-01-10 10:00:00`
2. GET `/emotion-analysis` 返回這 5 條記錄

### 場景 2: 用戶重新分析（一週後）
1. 系統創建 6 條新記錄，時間戳 `2025-01-17 14:30:00`
2. 資料庫現有 11 條記錄（5 + 6）
3. GET `/emotion-analysis` 只返回最新的 6 條記錄
4. GET `/emotion-analysis/history` 返回兩次分析的完整記錄

### 場景 3: 比較壓力變化
用戶可以查看歷史記錄，了解：
- 哪些壓力來源已經解決
- 哪些新的壓力來源出現
- 壓力類型的變化趨勢

## 優點

### ✅ 保留歷史
- 所有分析記錄都被保存
- 可以追蹤壓力變化趨勢
- 不會丟失任何資料

### ✅ 介面簡潔
- 預設只顯示最新分析
- 避免資訊過載
- 心智圖保持清晰

### ✅ 靈活查詢
- 需要時可以查看完整歷史
- 支援趨勢分析
- 可以匯出歷史資料

### ✅ 資料完整性
- 同一次分析的記錄使用相同時間戳
- 易於識別和分組
- 查詢效能良好

## 資料庫查詢範例

### 查詢最新分析
```sql
-- 1. 找出最新的分析時間
SELECT MAX(created_at) FROM emotion_analysis WHERE username = 'user123';

-- 2. 取得該時間的所有記錄
SELECT * FROM emotion_analysis 
WHERE username = 'user123' 
  AND created_at = '2025-01-13 15:30:00';
```

### 查詢所有歷史
```sql
-- 取得所有不同的分析時間
SELECT DISTINCT created_at 
FROM emotion_analysis 
WHERE username = 'user123' 
ORDER BY created_at DESC;
```

### 統計分析次數
```sql
SELECT COUNT(DISTINCT created_at) as total_analyses
FROM emotion_analysis 
WHERE username = 'user123';
```

## 效能考量

### 索引建議
現有的索引已足夠：
- `idx_emotion_analysis_username` - 用戶過濾
- `idx_emotion_analysis_created_at` - 時間排序

### 查詢優化
- 使用 `MAX(created_at)` 快速找到最新記錄
- 單一查詢即可獲取最新分析的所有記錄
- 歷史查詢使用 `DISTINCT` 避免重複

## 未來擴展

### 可能的新功能
1. **趨勢分析圖表**：顯示壓力類型隨時間的變化
2. **對比視圖**：並排比較兩次分析結果
3. **匯出報告**：生成包含歷史記錄的 PDF 報告
4. **定期提醒**：提醒用戶定期進行壓力分析
5. **壓力評分**：計算壓力水平的量化指標

### 資料清理策略（可選）
如果未來資料量過大，可以考慮：
- 保留最近 N 次分析（如 10 次）
- 歸檔超過一年的舊記錄
- 提供用戶手動刪除歷史記錄的選項

## 版本紀錄

### v1.1.0 (2025-01-13)
- ✅ 改為保留所有歷史記錄
- ✅ 預設查詢只返回最新分析
- ✅ 新增歷史記錄查詢 API
- ✅ 使用批次時間戳標識同次分析
- ✅ 改進查詢效能

### v1.0.0 (2025-01-13)
- 初始版本（會刪除舊記錄）
