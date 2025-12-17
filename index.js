require('dotenv').config({ override: true });

const { injectSpeedInsights } = require('@vercel/speed-insights');
const express = require('express');
const cors = require('cors'); // 引入 cors 中間件
const rateLimit = require('express-rate-limit');
const OpenAI = require('openai');
const { Pool } = require('pg'); // 改用 Pool 提供更好的並發處理
const { overlayTextOnImage } = require('./imageProcessor');
const { uploadToGithub } = require('./githubUploader');
//https://leya-backend-vercel.vercel.app/posts
const app = express();
const PORT = process.env.PORT || 3000;

injectSpeedInsights();

// 中間件
// 部署在反向代理（如 Vercel/NGINX）後方時，需信任代理以正確取得使用者 IP
// 並避免 express-rate-limit 在偵測 X-Forwarded-For 時拋出驗證錯誤
// 請僅信任最接近的 1 層代理（例如 Vercel/NGINX 前的一層），避免過度寬鬆的 true 設定
app.set('trust proxy', 1);
app.use(cors()); // 允許跨域請求
app.use(express.json()); // 解析 JSON 請求

// 僅針對 /chat 設定速率限制（避免瞬間觸發 OpenAI 限流）
const chatLimiter = rateLimit({
    windowMs: 60_000, // 1 分鐘視窗
    max: 30,          // 每 IP 每分鐘最多 30 次
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/chat', chatLimiter);

// OpenAI client（採用 SDK）
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 用記憶體暫存簡易上下文（注意：在無狀態平台會是暫時性的）
const memory = new Map();

// 系統提示與結構化規範
const SYSTEM_PROMPT = `
你現在是一位溫柔的心理諮詢師，請用繁體中文回覆，並以 JSON 格式輸出以下欄位：
- reply
- encouragement
- emotion（只能：快樂、悲傷、焦慮、生氣、壓力、內耗、孤單、迷惘、希望、平靜）
`.trim();

// 串流用提示：只輸出「回覆文字本身」，不含任何 JSON/欄位名稱/前綴，避免前端畫面出現 JSON
const STREAM_PROMPT = `
你現在是一位溫柔的心理諮詢師，請用繁體中文回覆使用者，
只輸出回覆的正文內容（純文字），不要輸出 JSON、不要包含欄位名稱或任何前綴。
`.trim();

const ALLOWED_EMOTIONS = ['快樂', '悲傷', '焦慮', '生氣', '壓力', '內耗', '孤單', '迷惘', '希望', '平靜'];
function coerceModelJson(text) {
    const match = text.match(/\{[\s\S]*\}/);
    const raw = match ? match[0] : text;
    let data; try { data = JSON.parse(raw); } catch { data = {}; }
    return {
        reply: typeof data.reply === 'string' ? data.reply : '',
        encouragement: typeof data.encouragement === 'string' ? data.encouragement : '',
        emotion: ALLOWED_EMOTIONS.includes(data.emotion) ? data.emotion : '平靜',
    };
}

// 簡易延遲/重試工具（指數退避 + 抖動）
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function withRetries(fn, { retries = 2, base = 500 } = {}) {
    let lastErr;
    for (let i = 0; i <= retries; i++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            // 僅對暫時性錯誤嘗試重試
            if (err?.status === 429 || err?.status === 500 || err?.code === 'ETIMEDOUT') {
                const backoff = base * Math.pow(2, i) + Math.floor(Math.random() * 200);
                await sleep(backoff);
                continue;
            }
            break; // 其他錯誤不重試
        }
    }
    throw lastErr;
}

// 設置 PostgreSQL 連線池 (使用 Pool 改善並發性能)
const pool = new Pool({
    user: 'a111070036',
    host: 'a111070036pg.postgres.database.azure.com',
    database: 'leya_talks',
    password: '@joke930731',
    port: 5432,
    ssl: { rejectUnauthorized: false },
    max: 20, // 最大連線數
    idleTimeoutMillis: 30000, // 30秒後釋放閒置連線
    connectionTimeoutMillis: 10000, // 10秒連線超時
    statement_timeout: 15000, // 15秒 SQL 執行超時
});

// 監聽連線池事件
pool.on('connect', () => {
    console.log('New client connected to PostgreSQL pool');
});

pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
});

// 保留 client 變數名稱以兼容現有程式碼
const client = pool;

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

    // 設定 10 秒超時保護
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Login timeout')), 10000);
    });

    try {
        // 使用 Promise.race 實現超時控制
        const queryPromise = client.query(
            'SELECT username, nickname, password_hash FROM "users" WHERE username = $1 OR email = $2',
            [usernameOrEmail, usernameOrEmail]
        );

        const result = await Promise.race([queryPromise, timeoutPromise]);
        const user = result.rows[0];

        console.log('Query result:', user);

        // 檢查用戶是否存在且密碼正確
        if (user && user.password_hash === password) {
            return res.json({ message: '登入成功', nickname: user.nickname, id: user.username });
        } else {
            return res.status(401).json({ message: '帳號或密碼錯誤' });
        }
    } catch (err) {
        if (err.message === 'Login timeout') {
            console.error('Login timeout for:', usernameOrEmail);
            return res.status(504).json({ 
                message: '登入請求超時，資料庫連線可能繁忙，請稍後再試或使用訪客模式' 
            });
        }
        console.error('Login query error', err.stack);
        return res.status(500).json({ 
            message: '伺服器錯誤，請稍後再試或使用訪客模式' 
        });
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


// 聊天功能（改為直接呼叫 OpenAI，取代外接 n8n）
app.post('/chat', async (req, res) => {
    try {
        const { userId, message } = req.body || {};
        if (!userId) return res.status(400).json({ error: '缺少 userId' });
        if (!message) return res.status(400).json({ error: '缺少 message' });

        // 目前使用單輪（可切換為多輪：取歷史最後 10 則）
        // const hist = memory.get(userId) || [];
        // const last10 = hist.slice(-10);
        // const messages = [
        //   { role: 'system', content: SYSTEM_PROMPT },
        //   ...last10,
        //   { role: 'user', content: message },
        // ];

        // 記憶鏈：取得聊天紀錄
        let historyMessages = [];
        try{
            const sql = 'SELECT user_message, bot_message, encourage_text, emotion FROM chat_history WHERE username = $1 ORDER BY created_time DESC LIMIT $2';
            const maxNum = 6;

            const historyResult = await client.query(sql, [userId, maxNum]);

            const rows = historyResult.rows.reverse();

            rows.forEach(row => {
                if (row.user_message) {
                    historyMessages.push({ role: 'user', content: row.user_message });
                }
                if (row.bot_message) {
                    // 為了讓模型保持輸出 JSON 格式，這裡將歷史紀錄還原為 JSON 字串
                    // 這樣模型會看到自己過去也是輸出 JSON，有助於維持格式穩定
                    const assistantContent = JSON.stringify({
                        reply: row.bot_message,
                        encouragement: row.encourage_text || '',
                        emotion: row.emotion || '平靜'
                    });
                    historyMessages.push({ role: 'assistant', content: assistantContent });
                }
            });

        }catch(dbErr){
            console.error('讀取歷史紀錄失敗：', dbErr);
        }

        const messages = [
            { role: 'system', content: SYSTEM_PROMPT },
            ...historyMessages,
            { role: 'user', content: message },
        ];

        let completion;
        try {
            completion = await withRetries(() => openai.chat.completions.create({
                model: 'gpt-4o-mini',
                temperature: 0.7,
                max_tokens: 300,
                messages,
            }));
        } catch (err) {
            // 429：額度/速率限制
            if (err?.status === 429) {
                const retryAfter = Number(err?.headers?.get?.('retry-after') ?? 0) || undefined;
                return res.status(429).json({
                    error: '目前已達到模型的速率限制或當前專案額度不足，請稍後再試。',
                    code: 'openai_rate_limit',
                    retryAfter,
                });
            }
            // 401：API Key 問題
            if (err?.status === 401) {
                return res.status(401).json({ error: 'OpenAI 認證失敗，請確認 API Key 或專案設定。', code: 'openai_auth' });
            }
            throw err;
        }

        const text = completion.choices?.[0]?.message?.content ?? '';
        const structured = coerceModelJson(text);

        // 可啟用多輪：
        // const newHist = [...last10, { role: 'user', content: message }, { role: 'assistant', content: structured.reply }];
        // memory.set(userId, newHist);

        return res.status(200).json(structured);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: '內部伺服器錯誤', detail: String(err?.message || err) });
    }
});

// 聊天串流（SSE）：逐步傳回 reply，結束時送出 final 事件附完整 JSON
app.get('/chat/stream', async (req, res) => {
    // 串流顯示已停用，改用一次性 /chat
    return res.status(410).json({ error: 'Streaming disabled. Please use POST /chat instead.' });
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

// 一鍵清除聊天記錄 (僅限 shuics)
app.delete('/chat-history/clear-all', async (req, res) => {
    const { username } = req.query;
    
    if (!username || username !== 'shuics') {
        return res.status(403).json({ 
            success: false, 
            message: '只有訪客模式可以使用清除功能' 
        });
    }

    try {
        // 刪除聊天記錄
        const chatResult = await client.query(
            'DELETE FROM chat_history WHERE username = $1',
            [username]
        );
        
        // 刪除相關圖片記錄
        const imageResult = await client.query(
            'DELETE FROM user_chat_image WHERE username = $1',
            [username]
        );

        console.log(`[ClearAll] 已清除 ${username} 的 ${chatResult.rowCount} 條聊天記錄和 ${imageResult.rowCount} 張圖片`);

        res.json({ 
            success: true, 
            message: '已清除所有聊天記錄',
            deletedChats: chatResult.rowCount,
            deletedImages: imageResult.rowCount
        });
    } catch (err) {
        console.error('Clear all chat history error:', err.stack);
        res.status(500).json({ 
            success: false, 
            message: '清除失敗，請稍後再試' 
        });
    }
});

// 一鍵清除心情日記 (僅限 shuics)
app.delete('/mood-journal/clear-all', async (req, res) => {
    const { username } = req.query;
    
    if (!username || username !== 'shuics') {
        return res.status(403).json({ 
            success: false, 
            message: '只有訪客模式可以使用清除功能' 
        });
    }

    try {
        const result = await client.query(
            'DELETE FROM mood_history WHERE username = $1',
            [username]
        );

        console.log(`[ClearAll] 已清除 ${username} 的 ${result.rowCount} 條心情日記`);

        res.json({ 
            success: true, 
            message: '已清除所有心情日記',
            deletedCount: result.rowCount
        });
    } catch (err) {
        console.error('Clear all mood journal error:', err.stack);
        res.status(500).json({ 
            success: false, 
            message: '清除失敗，請稍後再試' 
        });
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

// REBT 轉念練習完成：更新分析記錄並新增聊天與心情日記紀錄
app.post('/rebt/complete', async (req, res) => {
    // 前端傳來的資料
    const { id, username, event, belief, dispute, newBelief } = req.body;

    if (!id || !username) {
        return res.status(400).json({ success: false, message: '缺少必要參數' });
    }

    const clientConn = client;

    try {
        await clientConn.query('BEGIN'); // 開啟交易

        // ---------------------------------------------------------
        // 1. 更新 emotion_analysis 表 (讓當下的心智圖變綠色)
        // ---------------------------------------------------------
        const updateAnalysisQuery = `
            UPDATE emotion_analysis 
            SET is_resolved = true, 
                current_stress = 30, 
                user_dispute = $1,
                new_belief = $2 
            WHERE id = $3 AND username = $4
            RETURNING *
        `;
        const analysisResult = await clientConn.query(updateAnalysisQuery, [dispute, newBelief, id, username]);

        if (analysisResult.rows.length === 0) {
            await clientConn.query('ROLLBACK');
            return res.status(404).json({ success: false, message: '找不到該分析記錄' });
        }

        // ---------------------------------------------------------
        // 2. 新增一筆紀錄到 chat_history
        // ---------------------------------------------------------
        const chatUserContent = `我完成了一個轉念練習。事件是「${event}」，原本想法是「${belief}」，但我反駁了它：「${dispute}」。我現在的新觀點是：「${newBelief}」。`;
        const chatBotContent = `太棒了！能夠將「${belief}」轉化為「${newBelief}」，這顯示了你很好的自我覺察能力。`;

        await clientConn.query(`
            INSERT INTO chat_history (
                username, user_message, bot_message, encourage_text, emotion, created_time,
                is_rebt_log, rebt_event, rebt_old_belief, rebt_new_belief
            ) VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8, $9)
        `, [
            username, chatUserContent, chatBotContent, newBelief, '希望', true, event, belief, newBelief
        ]);

        // ---------------------------------------------------------
        // 3. ★ 新增：同步新增一筆紀錄到 mood_history
        // ---------------------------------------------------------
        // 心情日記的內容可以比較像是使用者的「自我獨白」
        const moodContent = `【轉念成功】\n針對「${event}」這件事，我發現我原本卡在「${belief}」的想法裡。\n經過思考後，我覺得：「${dispute}」。\n所以我決定用新的觀點來看待：「${newBelief}」。\n感覺心情輕鬆多了！`;

        await clientConn.query(`
            INSERT INTO mood_history (
                username, content, mood, created_at,
                is_rebt_log, rebt_event, rebt_old_belief, rebt_new_belief
            ) VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7)
        `, [
            username, 
            moodContent, 
            '希望',     // mood 設為正向情緒
            true,      // is_rebt_log
            event,     // rebt_event
            belief,    // rebt_old_belief
            newBelief  // rebt_new_belief
        ]);

        await clientConn.query('COMMIT'); // 提交交易

        console.log(`[REBT] User ${username} resolved analysis ID ${id} (Saved to Analysis, Chat, and Mood).`);

        res.json({ 
            success: true, 
            message: '療癒記錄已完整儲存',
            record: analysisResult.rows[0]
        });

    } catch (err) {
        await clientConn.query('ROLLBACK');
        console.error('REBT complete error:', err.stack);
        res.status(500).json({ success: false, message: '儲存失敗' });
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

        const prompt = `你是一位精通 REBT (理性情緒行為治療) 的心理諮詢專家。請根據以下用戶的聊天記錄和心情日記，分析其壓力來源，並依照 ABC 模型進行拆解。

聊天記錄：
${chatSummary}

心情日記：
${moodSummary}

請分析並回傳 JSON 物件，格式範例：
{
  "analysis": [
    {
      "category": "學業",
      "source": "期末考成績不理想", 
      "emotion": "焦慮",
      "impact": "失眠、暴飲暴食",
      "note": "我必須科科拿滿分，否則就是個失敗者"
    }
  ]
}

欄位填寫要求 (對應 REBT 模型)：
1. category (分類)：使用繁體中文，如學業、人際、家庭、財務、健康、未來、自我價值。
2. source (A - 促發事件)：客觀發生的事件 (Activating Event)。例如：「被主管批評」、「考試不及格」。
3. emotion (C - 情緒後果)：感受到的情緒 (Consequences - Emotion)。例如：「焦慮」、「憤怒」、「無助」。
4. impact (C - 行為/生理後果)：行為反應或生理影響 (Consequences - Behavior)。例如：「失眠」、「逃避社交」、「胃痛」。
5. note (B - 信念)：【關鍵】請偵測使用者潛在的「非理性信念」(Beliefs)。
   - 找出含有「必須」、「應該」、「一定」的絕對化要求。
   - 或者是「災難化思考」(完蛋了)、「低挫折容忍度」(受不了了)。
   - 範例：「如果不完美，我就沒價值」、「別人一定要對我好」。

整體要求：
1. 回傳包含 analysis 陣列的 JSON 物件。
2. 根據實際記錄內容分析，回傳 3-8 條記錄。
3. 若沒有明顯的非理性信念，note 欄位可描述使用者對該事件的解讀。`;

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

        // 5. 將分析結果儲存到 emotion_analysis 資料表（保留所有歷史記錄）
        const insertedRecords = [];
        // 記錄當前批次的時間戳，用於標識這次分析
        const batchTimestamp = new Date();
        
        for (const item of analysisResults) {
            try {
                const result = await client.query(
                    `INSERT INTO emotion_analysis (username, category, source, impact, emotion, note, created_at) 
                     VALUES ($1, $2, $3, $4, $5, $6, $7) 
                     RETURNING *`,
                    [
                        username,
                        item.category || '未分類',
                        item.source || '未知來源',
                        item.impact || null,
                        item.emotion || null,
                        item.note || null,
                        batchTimestamp
                    ]
                );
                insertedRecords.push(result.rows[0]);
            } catch (insertErr) {
                console.error('Insert emotion_analysis error:', insertErr);
            }
        }

        console.log(`[StressAnalysis] 已為用戶 ${username} 儲存 ${insertedRecords.length} 條新分析記錄`);

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

// 取得用戶的壓力來源分析記錄（只返回最新一次的分析）
app.get('/emotion-analysis', async (req, res) => {
    const { username } = req.query;
    
    if (!username) {
        return res.status(400).json({ success: false, message: '缺少 username 參數' });
    }

    try {
        // 先找出該用戶最新的分析時間
        const latestTimeResult = await client.query(
            `SELECT MAX(created_at) as latest_time 
             FROM emotion_analysis 
             WHERE username = $1`,
            [username]
        );

        const latestTime = latestTimeResult.rows[0]?.latest_time;

        if (!latestTime) {
            // 如果沒有任何記錄
            return res.json({ 
                success: true, 
                records: [],
                count: 0
            });
        }

        // 取得最新一次分析的所有記錄
        const result = await client.query(
            `SELECT id, username, category, source, impact, emotion, note, created_at,
                    is_resolved, current_stress, new_belief, user_dispute 
             FROM emotion_analysis 
             WHERE username = $1 AND created_at = $2
             ORDER BY id ASC`,
            [username, latestTime]
        );

        return res.json({ 
            success: true, 
            records: result.rows,
            count: result.rows.length,
            analysisDate: latestTime
        });
    } catch (err) {
        console.error('Fetch emotion analysis error:', err.stack);
        return res.status(500).json({ 
            success: false, 
            message: '伺服器錯誤，無法取得壓力來源分析記錄' 
        });
    }
});

// 取得用戶的所有歷史壓力分析記錄（按時間分組）
app.get('/emotion-analysis/history', async (req, res) => {
    const { username } = req.query;
    
    if (!username) {
        return res.status(400).json({ success: false, message: '缺少 username 參數' });
    }

    try {
        // 取得所有不同的分析時間
        const timesResult = await client.query(
            `SELECT DISTINCT created_at 
             FROM emotion_analysis 
             WHERE username = $1 
             ORDER BY created_at DESC`,
            [username]
        );

        const analysisTimes = timesResult.rows.map(row => row.created_at);

        // 為每個時間點取得記錄
        const historyData = [];
        for (const time of analysisTimes) {
            const recordsResult = await client.query(
                `SELECT id, username, category, source, impact, emotion, note, created_at 
                 FROM emotion_analysis 
                 WHERE username = $1 AND created_at = $2
                 ORDER BY id ASC`,
                [username, time]
            );

            historyData.push({
                analysisDate: time,
                records: recordsResult.rows,
                count: recordsResult.rows.length
            });
        }

        return res.json({ 
            success: true, 
            history: historyData,
            totalAnalyses: historyData.length
        });
    } catch (err) {
        console.error('Fetch emotion analysis history error:', err.stack);
        return res.status(500).json({ 
            success: false, 
            message: '伺服器錯誤，無法取得壓力分析歷史記錄' 
        });
    }
});

// 取得用戶的資料筆數總和（聊天 + 心情日記）
app.get('/user-data-count', async (req, res) => {
    const { username } = req.query;

    if (!username) {
        return res.status(400).json({ success: false, message: '缺少 username 參數' });
    }

    try {
        // 並行查詢提升效能
        const [chatCountResult, moodCountResult] = await Promise.all([
            client.query('SELECT COUNT(*)::int AS count FROM chat_history WHERE username = $1', [username]),
            client.query('SELECT COUNT(*)::int AS count FROM mood_history WHERE username = $1', [username])
        ]);

        const chat = chatCountResult.rows[0]?.count ?? 0;
        const mood = moodCountResult.rows[0]?.count ?? 0;
        const total = chat + mood;

        return res.json({
            success: true,
            counts: { chat, mood, total }
        });
    } catch (err) {
        console.error('Fetch user data count error:', err.stack || err);
        return res.status(500).json({ success: false, message: '伺服器錯誤，無法取得資料筆數' });
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

// ==================== 忘記密碼與重設密碼 API ====================

// 忘記密碼 - 發送重設連結
app.post('/forgot-password', async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ 
            success: false, 
            message: '請提供電子郵件地址' 
        });
    }

    try {
        // 檢查電子郵件是否存在
        const checkQuery = 'SELECT id, username, nickname FROM users WHERE email = $1';
        const checkResult = await client.query(checkQuery, [email]);

        if (checkResult.rows.length === 0) {
            // 為了安全性，即使郵件不存在也返回成功訊息（防止郵件探測）
            return res.json({ 
                success: true, 
                message: '如果該電子郵件存在於我們的系統中，您將收到重設密碼的連結' 
            });
        }

        const user = checkResult.rows[0];

        // 生成重設 token（使用簡單的隨機字串，生產環境應使用更安全的方法）
        const crypto = require('crypto');
        const resetToken = crypto.randomBytes(32).toString('hex');
        const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 小時後過期

        // 儲存 token 到資料庫
        const updateQuery = `
            UPDATE users 
            SET reset_token = $1, reset_token_expiry = $2 
            WHERE email = $3
        `;
        await client.query(updateQuery, [resetToken, resetTokenExpiry, email]);

        // 生成重設連結
        const frontendUrl = process.env.FRONTEND_URL || 'https://leyatalks.github.io';
        const resetLink = `${frontendUrl}/leya/reset-password?token=${resetToken}`;

        // 發送郵件（使用 nodemailer）
        // 注意：需要先安裝 nodemailer: npm install nodemailer
        const nodemailer = require('nodemailer');

        // 創建郵件傳輸器（使用 Gmail）
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER, // 您的 Gmail 地址
                pass: process.env.EMAIL_PASSWORD // 您的 Gmail 應用程式密碼
            }
        });

        // 郵件內容
        const mailOptions = {
            from: `"樂壓Talks" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: '樂壓Talks - 重設密碼',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <div style="background-color: #FAEAD3; padding: 20px; text-align: center;">
                        <h1 style="color: #8B4513; margin: 0;">樂壓Talks</h1>
                    </div>
                    <div style="padding: 30px; background-color: #ffffff;">
                        <h2 style="color: #333;">您好，${user.nickname || user.username}！</h2>
                        <p style="color: #666; line-height: 1.6;">
                            我們收到了您重設密碼的請求。請點擊下方按鈕來重設您的密碼：
                        </p>
                        <div style="text-align: center; margin: 30px 0;">
                            <a href="${resetLink}" 
                               style="background-color: #8B4513; color: white; padding: 12px 30px; 
                                      text-decoration: none; border-radius: 5px; display: inline-block;">
                                重設密碼
                            </a>
                        </div>
                        <p style="color: #666; font-size: 14px; line-height: 1.6;">
                            或複製以下連結到瀏覽器：<br/>
                            <a href="${resetLink}" style="color: #8B4513; word-break: break-all;">
                                ${resetLink}
                            </a>
                        </p>
                        <p style="color: #999; font-size: 12px; margin-top: 30px;">
                            此連結將在 1 小時後失效。<br/>
                            如果您沒有請求重設密碼，請忽略此郵件。
                        </p>
                    </div>
                    <div style="background-color: #f5f5f5; padding: 20px; text-align: center; font-size: 12px; color: #999;">
                        <p>© 2025 樂壓Talks. All rights reserved.</p>
                        <p>世新大學資訊傳播學系專題作品</p>
                    </div>
                </div>
            `
        };

        // 發送郵件
        await transporter.sendMail(mailOptions);

        res.json({ 
            success: true, 
            message: '重設密碼連結已發送到您的信箱，請檢查您的郵件' 
        });

    } catch (err) {
        console.error('Forgot password error:', err);
        res.status(500).json({ 
            success: false, 
            message: '發送重設連結時發生錯誤，請稍後再試' 
        });
    }
});

// 驗證重設 token
app.get('/validate-reset-token', async (req, res) => {
    const { token } = req.query;

    if (!token) {
        return res.status(400).json({ 
            success: false, 
            valid: false,
            message: '缺少 token' 
        });
    }

    try {
        const query = `
            SELECT id, username, reset_token_expiry 
            FROM users 
            WHERE reset_token = $1
        `;
        const result = await client.query(query, [token]);

        if (result.rows.length === 0) {
            return res.json({ 
                success: false, 
                valid: false,
                message: '無效的重設連結' 
            });
        }

        const user = result.rows[0];
        const now = new Date();

        if (user.reset_token_expiry < now) {
            return res.json({ 
                success: false, 
                valid: false,
                message: '重設連結已過期' 
            });
        }

        res.json({ 
            success: true, 
            valid: true,
            message: 'Token 有效' 
        });

    } catch (err) {
        console.error('Validate token error:', err);
        res.status(500).json({ 
            success: false, 
            valid: false,
            message: '驗證 token 時發生錯誤' 
        });
    }
});

// 重設密碼
app.post('/reset-password', async (req, res) => {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
        return res.status(400).json({ 
            success: false, 
            message: '缺少必要參數' 
        });
    }

    if (newPassword.length < 6) {
        return res.status(400).json({ 
            success: false, 
            message: '密碼長度至少需要 6 個字元' 
        });
    }

    try {
        // 驗證 token
        const checkQuery = `
            SELECT id, username, reset_token_expiry 
            FROM users 
            WHERE reset_token = $1
        `;
        const checkResult = await client.query(checkQuery, [token]);

        if (checkResult.rows.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: '無效的重設連結' 
            });
        }

        const user = checkResult.rows[0];
        const now = new Date();

        if (user.reset_token_expiry < now) {
            return res.status(400).json({ 
                success: false, 
                message: '重設連結已過期，請重新申請' 
            });
        }

        // 更新密碼並清除 token
        const updateQuery = `
            UPDATE users 
            SET password_hash = $1, reset_token = NULL, reset_token_expiry = NULL 
            WHERE id = $2
        `;
        await client.query(updateQuery, [newPassword, user.id]);

        res.json({ 
            success: true, 
            message: '密碼重設成功' 
        });

    } catch (err) {
        console.error('Reset password error:', err);
        res.status(500).json({ 
            success: false, 
            message: '重設密碼時發生錯誤' 
        });
    }
});

// 啟動伺服器
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
