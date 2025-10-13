// 壓力來源分析 API 測試腳本
// 使用方式: node test_stress_analysis.js

// const API_BASE_URL = 'http://localhost:3000'; // 本地測試
const API_BASE_URL = 'https://leya-backend-vercel.vercel.app'; // 生產環境

const TEST_USERNAME = 'admin'; // 測試用戶名

// 測試 1: 執行壓力來源分析
async function testAnalyzeStress() {
  console.log('\n=== 測試 1: 執行壓力來源分析 ===');
  try {
    const response = await fetch(`${API_BASE_URL}/analyze-stress`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username: TEST_USERNAME }),
    });

    const result = await response.json();
    console.log('狀態碼:', response.status);
    console.log('回應:', JSON.stringify(result, null, 2));

    if (result.success) {
      console.log('✅ 分析成功！');
      console.log(`   - 共生成 ${result.count} 條記錄`);
      if (result.records && result.records.length > 0) {
        console.log('   - 第一條記錄範例:');
        console.log(`     類型: ${result.records[0].category}`);
        console.log(`     來源: ${result.records[0].source}`);
        console.log(`     情緒: ${result.records[0].emotion}`);
      }
    } else {
      console.log('❌ 分析失敗:', result.message);
    }
  } catch (error) {
    console.error('❌ 測試失敗:', error.message);
  }
}

// 測試 2: 取得壓力分析記錄
async function testGetEmotionAnalysis() {
  console.log('\n=== 測試 2: 取得壓力分析記錄 ===');
  try {
    const response = await fetch(
      `${API_BASE_URL}/emotion-analysis?username=${encodeURIComponent(TEST_USERNAME)}`
    );

    const result = await response.json();
    console.log('狀態碼:', response.status);
    console.log('回應:', JSON.stringify(result, null, 2));

    if (result.success) {
      console.log('✅ 取得成功！');
      console.log(`   - 共 ${result.count} 條記錄`);
      
      if (result.records && result.records.length > 0) {
        console.log('\n   記錄列表:');
        result.records.forEach((record, idx) => {
          console.log(`   ${idx + 1}. [${record.category}] ${record.source}`);
          console.log(`      情緒: ${record.emotion || '無'}`);
          console.log(`      影響: ${record.impact || '無'}`);
          console.log(`      說明: ${record.note || '無'}`);
          console.log('');
        });
      }
    } else {
      console.log('❌ 取得失敗:', result.message);
    }
  } catch (error) {
    console.error('❌ 測試失敗:', error.message);
  }
}

// 測試 3: 刪除特定記錄（需要先有記錄 ID）
async function testDeleteEmotionAnalysis(recordId) {
  console.log('\n=== 測試 3: 刪除壓力分析記錄 ===');
  
  if (!recordId) {
    console.log('⚠️  跳過刪除測試（需要提供記錄 ID）');
    return;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/emotion-analysis/${recordId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username: TEST_USERNAME }),
    });

    const result = await response.json();
    console.log('狀態碼:', response.status);
    console.log('回應:', JSON.stringify(result, null, 2));

    if (result.success) {
      console.log('✅ 刪除成功！');
    } else {
      console.log('❌ 刪除失敗:', result.message);
    }
  } catch (error) {
    console.error('❌ 測試失敗:', error.message);
  }
}

// 執行所有測試
async function runAllTests() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║  壓力來源分析 API 測試                 ║');
  console.log('╚════════════════════════════════════════╝');
  console.log(`API 端點: ${API_BASE_URL}`);
  console.log(`測試用戶: ${TEST_USERNAME}`);

  // 先取得現有記錄
  await testGetEmotionAnalysis();

  // 執行新的分析
  await testAnalyzeStress();

  // 再次取得記錄以確認分析結果
  await testGetEmotionAnalysis();

  // 刪除測試（可選，取消註解來測試刪除功能）
  // const recordIdToDelete = 1; // 替換為實際的記錄 ID
  // await testDeleteEmotionAnalysis(recordIdToDelete);

  console.log('\n╔════════════════════════════════════════╗');
  console.log('║  測試完成                              ║');
  console.log('╚════════════════════════════════════════╝\n');
}

// 執行測試
runAllTests().catch(console.error);
