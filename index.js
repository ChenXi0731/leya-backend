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

// 啟動伺服器
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
