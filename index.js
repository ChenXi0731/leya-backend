require('dotenv').config();

const { injectSpeedInsights } = require('@vercel/speed-insights');
const express = require('express');
const cors = require('cors'); // 引入 cors 中間件
const { Client } = require('pg'); // 引入 pg 客戶端
const { overlayTextOnImage } = require('./imageProcessor');
const { uploadToGithub } = require('./githubUploader');
//https://leya-backend-vercel.vercel.app/posts
const app = express();
const PORT = process.env.PORT || 3000;

injectSpeedInsights();

// 中間件
app.use(cors()); // 允許跨域請求
app.use(express.json()); // 解析 JSON 請求

// 設置 PostgreSQL 連接
const client = new Client({
    user: 'a111070036',
    host: 'a111070036pg.postgres.database.azure.com',
    database: 'leya_talks', // 替換為你的資料庫名稱
    password: '@joke930731',
    port: 5432,
    ssl: { rejectUnauthorized: false } // 如果需要 SSL 連接
});

// 連接到資料庫
client.connect()
    .then(() => console.log('Connected to PostgreSQL'))
    .catch(err => console.error('Connection error', err.stack));

// 假設的用戶數據
const users = [
    { username: 'admin1', password: 'password1' }
];

// // 路由範例
// app.get('/', (req, res) => {
//     res.send('Hello World!');
// });

// // 新增的測試路由
// app.get('/hello', (req, res) => {
//     res.send('Hello world');
// });

// 登入路由
app.get('/', (req, res) => {
    res.send('Hello World!')
})


// 註冊路由
app.post('/register', async (req, res) => {
    const { email, username, password, nickname } = req.body;
    console.log(`Received registration request for: ${username}`);

    if (!email || !username || !password || !nickname) {
        return res.status(400).json({ message: '所有欄位都是必填的' });
    }

    if (!email.includes('@')) {
        return res.status(400).json({ message: '請輸入有效的電子郵件' });
    }

    if (password.length < 6) {
        return res.status(400).json({ message: '密碼長度至少需要6個字符' });
    }

    try {
        // 檢查用戶名和電子郵件是否已存在
        const checkUser = await client.query(
            'SELECT * FROM "users" WHERE username = $1 OR email = $2',
            [username, email]
        );

        if (checkUser.rows.length > 0) {
            const existingUser = checkUser.rows[0];
            // 判斷是用戶名還是電子郵件重複
            if (existingUser.username === username) {
                return res.status(400).json({ message: '此帳號已被使用' });
            } else {
                return res.status(400).json({ message: '此電子郵件已被註冊' });
            }
        }

        // 創建新用戶
        // 注意: 這裡我們直接存儲明文密碼到 password_hash 字段，與登入系統保持一致
        // 在實際生產環境中，應該使用加密算法來存儲密碼
        const result = await client.query(
            'INSERT INTO "users" (username, email, password_hash, nickname, created_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING username, nickname',
            [username, email, password, nickname]
        );

        console.log('User created successfully:', result.rows[0]);

        return res.status(201).json({
            message: '註冊成功',
            user: {
                username: result.rows[0].username,
                nickname: result.rows[0].nickname
            }
        });
    } catch (err) {
        console.error('Registration error', err.stack);
        return res.status(500).json({ message: '伺服器錯誤，註冊失敗' });
    }
});

app.post('/login', async (req, res) => {
    const { usernameOrEmail, password } = req.body;
    console.log(`Received login request for: ${usernameOrEmail}`);

    try {
        // 查詢用戶，檢查 username 或 email
        const result = await client.query(
            'SELECT username, nickname, password_hash FROM "users" WHERE username = $1 OR email = $2',
            [usernameOrEmail, usernameOrEmail]
        );
        const user = result.rows[0];

        console.log('Query result:', user); // 添加這行來檢查查詢結果

        // 檢查用戶是否存在且密碼正確
        if (user && user.password_hash === password) {
            return res.json({ message: '登入成功', nickname: user.nickname, id: user.username });
        } else {
            return res.status(401).json({ message: '帳號或密碼錯誤' });
        }
    } catch (err) {
        console.error('Query error', err.stack);
        return res.status(500).json({ message: '伺服器錯誤' });
    }
});

// 取得所有貼文
app.get('/posts', async (req, res) => {
    try {
        const result = await client.query(`
            SELECT
                posts.*,
                users.nickname,
                users.username,
                COALESCE(
                    ARRAY(
                        SELECT image_url FROM post_images WHERE post_id = posts.id
                    ),
                    ARRAY[]::text[]
                ) AS images
            FROM posts
            LEFT JOIN users ON posts.user_id = users.id
            ORDER BY posts.created_at DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('Fetch posts error', err.stack);
        res.status(500).json({ message: '伺服器錯誤' });
    }
});

// 新增貼文（僅限管理員，支援多張圖片和贊助商資訊）
app.post('/posts', async (req, res) => {
    const { user_id, content, images, donate_name, donate_url, donate_engname } = req.body;
    if (user_id !== 999) {
        return res.status(403).json({ message: '只有管理員可以新增贊助貼文' });
    }
    const clientConn = client;
    try {
        await clientConn.query('BEGIN');
        const postResult = await clientConn.query(
            'INSERT INTO posts (user_id, content, donate_name, donate_url, donate_engname, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, NOW(), NOW()) RETURNING *',
            [user_id, content, donate_name, donate_url, donate_engname]
        );
        const post = postResult.rows[0];
        if (Array.isArray(images) && images.length > 0) {
            for (const url of images.slice(0, 5)) {
                await clientConn.query(
                    'INSERT INTO post_images (post_id, image_url) VALUES ($1, $2)',
                    [post.id, url]
                );
            }
        }
        await clientConn.query('COMMIT');
        res.status(201).json(post);
    } catch (err) {
        await clientConn.query('ROLLBACK');
        console.error('Create post error', err.stack);
        res.status(500).json({ message: '伺服器錯誤' });
    }
});

// 修改貼文（僅限管理員，支援多張圖片和贊助商資訊）
app.put('/posts/:id', async (req, res) => {
    const { user_id, content, images, donate_name, donate_url, donate_engname } = req.body;
    const { id } = req.params;
    if (user_id !== 999) {
        return res.status(403).json({ message: '只有管理員可以修改贊助貼文' });
    }
    const clientConn = client;
    try {
        await clientConn.query('BEGIN');
        const result = await clientConn.query(
            'UPDATE posts SET content=$1, donate_name=$2, donate_url=$3, donate_engname=$4, updated_at=NOW() WHERE id=$5 AND user_id=999 RETURNING *',
            [content, donate_name, donate_url, donate_engname, id]
        );
        if (result.rows.length === 0) {
            await clientConn.query('ROLLBACK');
            return res.status(404).json({ message: '找不到該贊助貼文' });
        }
        // 刪除舊圖片
        await clientConn.query('DELETE FROM post_images WHERE post_id=$1', [id]);
        // 新增新圖片
        if (Array.isArray(images) && images.length > 0) {
            for (const url of images.slice(0, 5)) {
                await clientConn.query(
                    'INSERT INTO post_images (post_id, image_url) VALUES ($1, $2)',
                    [id, url]
                );
            }
        }
        await clientConn.query('COMMIT');
        res.json(result.rows[0]);
    } catch (err) {
        await clientConn.query('ROLLBACK');
        console.error('Update post error', err.stack);
        res.status(500).json({ message: '伺服器錯誤' });
    }
});

// 刪除貼文（僅限管理員）
app.delete('/posts/:id', async (req, res) => {
    const { user_id } = req.body;
    const { id } = req.params;
    if (user_id !== 999) {
        return res.status(403).json({ message: '只有管理員可以刪除贊助貼文' });
    }
    try {
        const result = await client.query(
            'DELETE FROM posts WHERE id=$1 AND user_id=999 RETURNING *',
            [id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ message: '找不到該贊助貼文' });
        }
        res.json({ message: '刪除成功' });
    } catch (err) {
        console.error('Delete post error', err.stack);
        res.status(500).json({ message: '伺服器錯誤' });
    }
});


//聊天功能
app.post('/chat', async (req, res) => {
    const webhookUrl = "https://yu0402-n8n-free.hf.space/webhook/chat";
    const { message, userId } = req.body;

    if (!message) {
        return res.status(400).json({ message: '缺少 message 參數' });
    }

    try {
        const response = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                message,
                userId: userId || "demo-visitor"
            })
        });

        const data = await response.json();
        const replyData = data[0]?.output || {};
        const reply = {
            reply: replyData.reply || "🤖 沒有回應",
            encouragement: replyData.encouragement || "",
            emotion: replyData.emotion || "未知"
        };
        res.json(reply);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "伺服器錯誤，請稍後再試。" });
    }
});

//儲存聊天訊息
app.post('/chat-history', async (req, res) => {
    const { username, user_message, bot_message, encourage_text, emotion } = req.body;
    if (!username || !user_message || !bot_message) {
        return res.status(400).json({ message: '缺少必要欄位' });
    }
    try {
        // 1. 儲存聊天記錄到 chat_history 表 (這是您已有的邏輯)
        const insertResult = await client.query(
            `INSERT INTO chat_history (username, user_message, bot_message, encourage_text, emotion)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id`,
            [username, user_message, bot_message, encourage_text, emotion]
        );
        const chatHistoryId = insertResult.rows[0].id;
        console.log(`[ChatHistory] 聊天記錄已儲存至資料庫: user=${username}`);

        // --- 開始新增的圖片處理流程 ---
        if (emotion && encourage_text) {
            console.log(`[ChatHistory] 偵測到 emotion (${emotion}) 和 encourage_text，準備處理圖片。`);
            let backgroundImageUrl = null;

            // 2. 根據 emotion 從 emotion_imageurl 表獲取背景圖片 URL
            try {
                const emotionImageResult = await client.query(
                    'SELECT imageurl FROM emotion_imageurl WHERE emotion = $1 ORDER BY RANDOM() LIMIT 1',
                    [emotion]
                );

                if (emotionImageResult.rows.length > 0) {
                    backgroundImageUrl = emotionImageResult.rows[0].imageurl;
                    console.log(`[ChatHistory] 成功獲取到 emotion '${emotion}' 的背景圖片 URL: ${backgroundImageUrl}`);
                } else {
                    try {
                        const commonEmotionResult = await client.query(
                            'SELECT imageurl FROM emotion_imageurl WHERE emotion = $1 ORDER BY RANDOM() LIMIT 1',
                            ['通用']
                        );
                        console.log(`[ChatHistory] 未找到 emotion '${emotion}' 對應的背景圖片，因此採用通用圖片。`);

                        if (commonEmotionResult.rows.length > 0) {
                            backgroundImageUrl = commonEmotionResult.rows[0].imageurl;
                            console.log(`[ChatHistory] 成功獲取到通用的背景圖片 URL: ${backgroundImageUrl}`);
                        } else {
                            console.warn(`[ChatHistory] 未找到 emotion '${emotion}' 對應的背景圖片，通用圖片採用亦失敗`);
                        }
                    } catch(commonErr) {
                        console.error(`[ChatHistory] 查詢 emotion_imageurl 表時出錯: ${commonErr.message}`, commonErr.stack);
                    }
                    
                }
            } catch (dbError) {
                console.error(`[ChatHistory] 查詢 emotion_imageurl 表時出錯: ${dbError.message}`, dbError.stack);
                // 即使這裡出錯，也可能希望聊天記錄本身的回應成功，所以不直接 return res.status(500)
            }

            // 3. 如果獲取到背景圖 URL，則進行圖片合成
            if (backgroundImageUrl) {
                try {
                    console.log(`[ChatHistory] 開始合成圖片。背景: ${backgroundImageUrl}, 文字: "${encourage_text}"`);
                    const imageBuffer = await overlayTextOnImage(backgroundImageUrl, encourage_text);
                    console.log(`[ChatHistory] 圖片合成成功 (Buffer 長度: ${imageBuffer.length} bytes)。`);

                    // 4. 上傳 imageBuffer 到 GitHub
                    let githubImageUrl = null;
                    if (imageBuffer && imageBuffer.length > 0) {
                        console.log(`[ChatHistory] 準備上傳圖片到 GitHub for user: ${username}`);
                        githubImageUrl = await uploadToGithub(username, imageBuffer);
                        
                        if (githubImageUrl) {
                            console.log(`[ChatHistory] GitHub 上傳完成，圖片 URL: ${githubImageUrl}`);
                        } else {
                            console.warn(`[ChatHistory] GitHub 上傳失敗或未返回 URL for user: ${username}`);
                        }
                    } else {
                        console.warn(`[ChatHistory] imageBuffer 為空或無效，跳過 GitHub 上傳 for user: ${username}`);
                    }
                    
                    // 5. 將 githubImageUrl 和 username 存到 user_chat_image 表
                    if (githubImageUrl) {
                        try {
                            await client.query(
                                'INSERT INTO user_chat_image (username, image_url, chat_history_id) VALUES ($1, $2, $3)',
                                [username, githubImageUrl, chatHistoryId]
                            );
                            console.log(`[ChatHistory] 圖片連結已儲存至 user_chat_image: user=${username}, url=${githubImageUrl}`);
                        } catch (dbInsertError) {
                            console.error(`[ChatHistory] 儲存圖片連結到 user_chat_image 表失敗 for user ${username}: ${dbInsertError.message}`, dbInsertError.stack);
                            // 即使這裡失敗，也可能不希望影響主 API 回應
                        }
                    } else {
                        console.warn(`[ChatHistory] 未能獲取 GitHub 圖片 URL，跳過儲存到 user_chat_image for user: ${username}`);
                    }

                } catch (imageProcessingError) {
                    console.error(`[ChatHistory] 圖片處理或後續流程失敗 (user: ${username}): ${imageProcessingError.message}`, imageProcessingError.stack);
                    // 這裡的錯誤不應影響聊天記錄儲存成功的主回應
                    // 但您可能想記錄這個特定使用者的圖片生成失敗事件
                }
            } else {
                console.log(`[ChatHistory] 因未獲取到背景圖片 URL，跳過 ${username} 的圖片合成流程。`);
            }
        } else {
            console.log(`[ChatHistory] 未提供 emotion 或 encourage_text，跳過 ${username} 的圖片處理流程。`);
        }
        // --- 圖片處理流程結束 ---

        // 無論圖片處理是否成功，都回傳聊天記錄儲存成功的訊息
        // 圖片生成是一個背景的、附加的過程
        res.status(201).json({ 
            success: true, 
            message: '聊天記錄已儲存。',
            // 可以考慮在這裡加一個提示，比如：'圖片正在生成中 (如果適用)' 
        });

    } catch (err) {
        console.error('[ChatHistory] 儲存聊天記錄到資料庫時發生主錯誤:', err.stack);
        res.status(500).json({ success: false, message: '資料庫錯誤，儲存聊天記錄失敗' });
    }
});

//取得聊天訊息
app.get('/chat-history', async (req, res) => {
    const { username } = req.query;
    if (!username) {
        return res.status(400).json({ message: '缺少 username 參數' });
    }
    try {
        const result = await client.query(
            `SELECT ch.user_message, ch.bot_message, ch.encourage_text, ch.emotion, ch.created_time, uci.image_url
             FROM chat_history ch
             LEFT JOIN user_chat_image uci ON ch.id = uci.chat_history_id
             WHERE ch.username = $1
             ORDER BY ch.created_time ASC`,
            [username]
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: '資料庫錯誤' });
    }
});

// 心情日記：儲存
app.post('/mood-journal', async (req, res) => {
    const { username, content, mood, created_at } = req.body;
    if (!username) {
        return res.status(400).json({ success: false, message: '缺少必要欄位：username' });
    }
    try {
        const result = await client.query(
            'INSERT INTO mood_history (username, content, mood, created_at) VALUES ($1, $2, $3, $4) RETURNING id, username, content, mood, created_at',
            [username, content || null, mood || null, created_at || new Date().toISOString()]
        );
        res.status(201).json({ success: true, item: result.rows[0] });
    } catch (err) {
        console.error('Insert mood journal error', err.stack);
        res.status(500).json({ success: false, message: '伺服器錯誤，無法儲存心情日記' });
    }
});

// 心情日記：查詢（依使用者）
app.get('/mood-journal', async (req, res) => {
    const { username } = req.query;
    if (!username) {
        return res.status(400).json({ success: false, message: '缺少 username 參數' });
    }
    try {
        const result = await client.query(
            'SELECT id, username, content, mood, created_at FROM mood_history WHERE username = $1 ORDER BY created_at ASC',
            [username]
        );
        res.json({ success: true, items: result.rows });
    } catch (err) {
        console.error('Fetch mood journal error', err.stack);
        res.status(500).json({ success: false, message: '伺服器錯誤，無法取得心情日記' });
    }
});

// 心情日記：更新
app.put('/mood-journal/:id', async (req, res) => {
    const { id } = req.params;
    const { content, mood, created_at } = req.body;
    if (!id) return res.status(400).json({ success: false, message: '缺少 id' });
    try {
        let query = 'UPDATE mood_history SET content=$1, mood=$2';
        const params = [content || null, mood || null];
        if (created_at) {
            query += ', created_at=$3 WHERE id=$4 RETURNING id, username, content, mood, created_at';
            params.push(created_at, id);
        } else {
            query += ' WHERE id=$3 RETURNING id, username, content, mood, created_at';
            params.push(id);
        }
        const result = await client.query(query, params);
        if (result.rows.length === 0) return res.status(404).json({ success: false, message: '找不到該日記' });
        res.json({ success: true, item: result.rows[0] });
    } catch (err) {
        console.error('Update mood journal error', err.stack);
        res.status(500).json({ success: false, message: '伺服器錯誤，無法更新心情日記' });
    }
});

// 心情日記：刪除
app.delete('/mood-journal/:id', async (req, res) => {
    const { id } = req.params;
    if (!id) return res.status(400).json({ success: false, message: '缺少 id' });
    try {
        const result = await client.query('DELETE FROM mood_history WHERE id=$1 RETURNING id', [id]);
        if (result.rows.length === 0) return res.status(404).json({ success: false, message: '找不到該日記' });
        res.json({ success: true, message: '刪除成功' });
    } catch (err) {
        console.error('Delete mood journal error', err.stack);
        res.status(500).json({ success: false, message: '伺服器錯誤，無法刪除心情日記' });
    }
});

// 根據情緒隨機取得圖片 URL
app.get('/emotion-image/:emotion', async (req, res) => {
    const { emotion } = req.params;
    // 將前端傳來的情緒名稱對應到資料庫中的儲存值
    // 例如，如果前端傳來 'happy'，而資料庫儲存的是 '快樂'
    // 這裡可以做一個映射，或者確保前端傳來的值與資料庫一致
    // 為了簡單起見，假設前端會直接傳來資料庫中儲存的情緒中文名稱

    if (!emotion) {
        return res.status(400).json({ message: '缺少 emotion 參數' });
    }

    try {
        const result = await client.query(
            'SELECT imageurl FROM emotion_imageurl WHERE emotion = $1 ORDER BY RANDOM() LIMIT 1',
            [emotion]
        );

        if (result.rows.length > 0) {
            res.json({ imageUrl: result.rows[0].imageurl });
        } else {
            res.status(404).json({ message: '找不到對應情緒的圖片' });
        }
    } catch (err) {
        console.error('Error fetching emotion image', err.stack);
        res.status(500).json({ message: '伺服器錯誤' });
    }
});

// 產生放鬆小訣竅（使用 OpenAI）
app.get('/relax-tips', async (req, res) => {
    try {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ success: false, message: '伺服器未設定 OPENAI_API_KEY' });
        }

        // 可選參數：提示數量，預設 3，限制 1~5
        let count = parseInt(req.query.count || '3', 10);
        if (isNaN(count) || count < 1) count = 3;
        if (count > 5) count = 5;

        const prompt = `請以繁體中文產生 ${count} 則可立即實踐的放鬆小訣竅，每則 12~20 個字以內，內容務必健康、正向且安全。只回傳 JSON，格式：{"tips":["...","..."]}。`;

        const resp = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: 'You generate short, actionable relaxation tips in Traditional Chinese. Respond with valid JSON only.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.7,
                max_tokens: 300
            })
        });

        if (!resp.ok) {
            const text = await resp.text();
            console.error('OpenAI error:', text);
            return res.status(502).json({ success: false, message: 'OpenAI 呼叫失敗' });
        }

        const data = await resp.json();
        const content = data?.choices?.[0]?.message?.content || '';
        let tips = [];
        try {
            const parsed = JSON.parse(content);
            if (Array.isArray(parsed?.tips)) tips = parsed.tips;
        } catch (e) {
            // 若非 JSON，就嘗試用換行切割，取非空行
            tips = String(content).split(/\r?\n/).map(s => s.trim()).filter(Boolean).slice(0, count);
        }

        // 基本清理：限制長度、移除開頭序號
        tips = tips.map(t => t.replace(/^\d+[\.\)]\s*/, '').slice(0, 40));
        if (tips.length === 0) tips = ['深呼吸放慢步調', '到窗邊看看遠方', '寫下此刻的小煩惱'];

        return res.json({ success: true, tips });
    } catch (err) {
        console.error('relax-tips error:', err);
        return res.status(500).json({ success: false, message: '伺服器錯誤，無法產生放鬆小訣竅' });
    }
});

// 暖心小語（使用 OpenAI，最多 10 個中文字）
app.get('/warm-words', async (req, res) => {
    try {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ success: false, message: '伺服器未設定 OPENAI_API_KEY' });
        }

        const prompt = '請輸出一段不超過 10 個中文字的暖心金句，語氣溫柔正向。只回傳純文字，不要任何標點、emoji、引號或前綴。';

        const resp = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: 'You respond in Traditional Chinese with very short, warm phrases only.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.7,
                max_tokens: 50
            })
        });

        if (!resp.ok) {
            const text = await resp.text();
            console.error('OpenAI warm-words error:', text);
            return res.status(502).json({ success: false, message: 'OpenAI 呼叫失敗' });
        }

        const data = await resp.json();
        let text = (data?.choices?.[0]?.message?.content || '').trim();
        // 移除不必要的符號與換行
        text = text.replace(/["'`\n\r]/g, '').replace(/^\s+|\s+$/g, '');
        // 以「字數」簡單截斷至 10（UTF-16 單位，對一般中英文足夠）
        if (text.length > 10) text = text.slice(0, 10);
        if (!text) text = '你做得很好';

        return res.json({ success: true, text });
    } catch (err) {
        console.error('warm-words error:', err);
        return res.status(500).json({ success: false, message: '伺服器錯誤，無法產生暖心小語' });
    }
});

// 壓力來源分析：使用 OpenAI 分析用戶的聊天與心情記錄
app.post('/analyze-stress', async (req, res) => {
    const { username } = req.body;
    
    if (!username) {
        return res.status(400).json({ success: false, message: '缺少必要欄位：username' });
    }

    try {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ success: false, message: '伺服器未設定 OPENAI_API_KEY' });
        }

        // 1. 從資料庫查詢用戶的聊天記錄
        const chatResult = await client.query(
            `SELECT user_message, bot_message, emotion, created_time 
             FROM chat_history 
             WHERE username = $1 
             ORDER BY created_time DESC 
             LIMIT 50`,
            [username]
        );

        // 2. 從資料庫查詢用戶的心情記錄
        const moodResult = await client.query(
            `SELECT content, mood, created_at 
             FROM mood_history 
             WHERE username = $1 
             ORDER BY created_at DESC 
             LIMIT 30`,
            [username]
        );

        const chatHistory = chatResult.rows;
        const moodHistory = moodResult.rows;

        // 檢查是否有足夠的數據進行分析
        if (chatHistory.length === 0 && moodHistory.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: '該用戶沒有足夠的聊天或心情記錄可供分析' 
            });
        }

        // 3. 準備提示詞給 OpenAI
        const chatSummary = chatHistory.map((chat, idx) => 
            `[${idx + 1}] 用戶: ${chat.user_message || '無'} | 情緒: ${chat.emotion || '無'}`
        ).join('\n');

        const moodSummary = moodHistory.map((mood, idx) => 
            `[${idx + 1}] 心情: ${mood.mood || '無'} | 內容: ${mood.content || '無'}`
        ).join('\n');

        const prompt = `你是一位專業的心理健康分析師。請根據以下用戶的聊天記錄和心情日記，分析其壓力來源。

聊天記錄：
${chatSummary}

心情日記：
${moodSummary}

請分析壓力來源並回傳 JSON 物件，格式範例：
{
  "analysis": [
    {
      "category": "學業",
      "source": "考試壓力",
      "impact": "睡眠",
      "emotion": "焦慮",
      "note": "期末考臨近，準備不足導致睡眠品質下降"
    }
  ]
}

要求：
1. 回傳包含 analysis 陣列的 JSON 物件
2. 根據實際記錄內容分析，回傳 3-8 條記錄
3. category 使用繁體中文：學業、人際、家庭、財務、健康、未來等
4. 每條記錄必須有明確依據
5. note 欄位 20-40 字具體描述`;

        // 4. 呼叫 OpenAI API
        const resp = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                    { 
                        role: 'system', 
                        content: 'You are a professional mental health analyst. Always respond with valid JSON array only. Do not use markdown code blocks or any other formatting. Response must start with [ and end with ].' 
                    },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.7,
                max_tokens: 2000,
                response_format: { type: "json_object" }
            })
        });

        if (!resp.ok) {
            const text = await resp.text();
            console.error('OpenAI stress analysis error:', text);
            return res.status(502).json({ success: false, message: 'OpenAI 呼叫失敗' });
        }

        const data = await resp.json();
        let content = data?.choices?.[0]?.message?.content || '';
        
        // 清理 OpenAI 回應：移除 markdown 代碼塊標記
        content = content.trim();
        // 移除 ```json 開頭和 ``` 結尾
        content = content.replace(/^```json\s*/i, '').replace(/^```\s*/i, '');
        content = content.replace(/\s*```$/i, '');
        content = content.trim();
        
        let analysisResults = [];
        try {
            // 嘗試解析 JSON
            const parsed = JSON.parse(content);
            // 如果回傳的是物件且包含 analysis 陣列
            if (parsed.analysis && Array.isArray(parsed.analysis)) {
                analysisResults = parsed.analysis;
            } 
            // 如果回傳的直接是陣列
            else if (Array.isArray(parsed)) {
                analysisResults = parsed;
            }
            // 如果是單一物件，轉為陣列
            else if (typeof parsed === 'object') {
                analysisResults = [parsed];
            }
        } catch (e) {
            console.error('JSON parse error:', e);
            console.error('Original content:', data?.choices?.[0]?.message?.content);
            console.error('Cleaned content:', content);
            return res.status(500).json({ 
                success: false, 
                message: 'AI 回應格式錯誤，無法解析分析結果',
                debug: process.env.NODE_ENV === 'development' ? content : undefined
            });
        }

        // 5. 將分析結果儲存到 emotion_analysis 資料表
        const insertedRecords = [];
        for (const item of analysisResults) {
            try {
                const result = await client.query(
                    `INSERT INTO emotion_analysis (username, category, source, impact, emotion, note, created_at) 
                     VALUES ($1, $2, $3, $4, $5, $6, NOW()) 
                     RETURNING *`,
                    [
                        username,
                        item.category || '未分類',
                        item.source || '未知來源',
                        item.impact || null,
                        item.emotion || null,
                        item.note || null
                    ]
                );
                insertedRecords.push(result.rows[0]);
            } catch (insertErr) {
                console.error('Insert emotion_analysis error:', insertErr);
            }
        }

        return res.json({ 
            success: true, 
            message: `成功分析並儲存 ${insertedRecords.length} 條壓力來源記錄`,
            records: insertedRecords,
            count: insertedRecords.length
        });

    } catch (err) {
        console.error('Analyze stress error:', err.stack);
        return res.status(500).json({ 
            success: false, 
            message: '伺服器錯誤，壓力來源分析失敗' 
        });
    }
});

// 取得用戶的壓力來源分析記錄
app.get('/emotion-analysis', async (req, res) => {
    const { username } = req.query;
    
    if (!username) {
        return res.status(400).json({ success: false, message: '缺少 username 參數' });
    }

    try {
        const result = await client.query(
            `SELECT id, username, category, source, impact, emotion, note, created_at 
             FROM emotion_analysis 
             WHERE username = $1 
             ORDER BY created_at DESC`,
            [username]
        );

        return res.json({ 
            success: true, 
            records: result.rows,
            count: result.rows.length
        });
    } catch (err) {
        console.error('Fetch emotion analysis error:', err.stack);
        return res.status(500).json({ 
            success: false, 
            message: '伺服器錯誤，無法取得壓力來源分析記錄' 
        });
    }
});

// 刪除特定壓力來源分析記錄
app.delete('/emotion-analysis/:id', async (req, res) => {
    const { id } = req.params;
    const { username } = req.body;

    if (!id || !username) {
        return res.status(400).json({ success: false, message: '缺少必要參數' });
    }

    try {
        const result = await client.query(
            'DELETE FROM emotion_analysis WHERE id = $1 AND username = $2 RETURNING *',
            [id, username]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: '找不到該記錄或無權限刪除' 
            });
        }

        return res.json({ 
            success: true, 
            message: '刪除成功',
            record: result.rows[0]
        });
    } catch (err) {
        console.error('Delete emotion analysis error:', err.stack);
        return res.status(500).json({ 
            success: false, 
            message: '伺服器錯誤，無法刪除記錄' 
        });
    }
});

// 啟動伺服器
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
