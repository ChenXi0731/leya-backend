# JSON 解析錯誤修復說明

## 問題描述
在執行壓力來源分析時，可能遇到「AI 回應格式錯誤，無法解析分析結果」的錯誤。

## 根本原因
OpenAI API 回傳的內容可能包含：
1. Markdown 代碼塊標記（```json ... ```）
2. 不同的 JSON 格式（物件 vs 陣列）
3. 額外的空白字元或換行

## 已實施的修復

### 1. 內容清理
```javascript
// 移除 markdown 代碼塊標記
content = content.trim();
content = content.replace(/^```json\s*/i, '').replace(/^```\s*/i, '');
content = content.replace(/\s*```$/i, '');
content = content.trim();
```

### 2. 多格式支援
```javascript
// 支援三種格式：
// 1. { "analysis": [...] } - 物件包含陣列
// 2. [...] - 直接陣列
// 3. {...} - 單一物件
if (parsed.analysis && Array.isArray(parsed.analysis)) {
    analysisResults = parsed.analysis;
} else if (Array.isArray(parsed)) {
    analysisResults = parsed;
} else if (typeof parsed === 'object') {
    analysisResults = [parsed];
}
```

### 3. 改進的提示詞
- 明確要求回傳特定 JSON 格式
- 使用 `response_format: { type: "json_object" }` 強制 JSON 模式
- 提供清晰的格式範例

### 4. 增強的錯誤日誌
```javascript
console.error('Original content:', data?.choices?.[0]?.message?.content);
console.error('Cleaned content:', content);
// 開發環境下回傳除錯資訊
debug: process.env.NODE_ENV === 'development' ? content : undefined
```

## 測試建議

### 測試案例 1: 正常格式
期望 OpenAI 回傳：
```json
{
  "analysis": [
    {
      "category": "學業",
      "source": "考試壓力",
      "impact": "睡眠",
      "emotion": "焦慮",
      "note": "期末考臨近導致睡眠不足"
    }
  ]
}
```

### 測試案例 2: Markdown 包裹
如果 OpenAI 回傳：
```
```json
{
  "analysis": [...]
}
```
```
系統會自動清理 ```json 標記。

### 測試案例 3: 直接陣列
如果 OpenAI 回傳：
```json
[
  {
    "category": "學業",
    ...
  }
]
```
系統也能正確處理。

## 如何驗證修復

### 1. 本地測試
```bash
# 啟動後端
node index.js

# 執行測試腳本
node test_stress_analysis.js
```

### 2. 查看日誌
如果仍有錯誤，檢查控制台輸出：
```
JSON parse error: ...
Original content: ...
Cleaned content: ...
```

### 3. 開發模式除錯
設定環境變數：
```bash
NODE_ENV=development node index.js
```
API 錯誤回應會包含 `debug` 欄位，顯示清理後的內容。

## 如果問題仍然存在

### 檢查清單
- [ ] 確認 OPENAI_API_KEY 正確設定
- [ ] 確認使用的是 gpt-4o-mini 模型
- [ ] 檢查用戶有足夠的聊天/心情記錄
- [ ] 查看後端控制台的完整錯誤訊息
- [ ] 嘗試降低 temperature 值（提高確定性）

### 臨時解決方案
如果 AI 持續回傳無效格式，可以：
1. 移除 `response_format: { type: "json_object" }` 參數
2. 增加內容清理規則
3. 調整提示詞要求更明確的格式

### 聯絡支援
如果問題持續，請提供：
1. 完整的錯誤訊息
2. `Original content` 日誌
3. `Cleaned content` 日誌
4. 用戶的聊天/心情記錄數量

## 版本紀錄

### v1.0.1 (2025-01-13)
- ✅ 新增 markdown 代碼塊清理
- ✅ 支援多種 JSON 格式
- ✅ 改進提示詞
- ✅ 增強錯誤日誌
- ✅ 新增開發模式除錯資訊

### v1.0.0 (2025-01-13)
- 初始版本
