import { injectSpeedInsights } from '@vercel/speed-insights';
import express from 'express';
import cors from 'cors'; // 引入 cors 中間件
import { Client } from 'pg'; // 引入 pg 客戶端

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

// 啟動伺服器
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
