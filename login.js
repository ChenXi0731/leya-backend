import { Client } from 'pg';

const client = new Client({
    user: 'a111070036',
    host: 'a111070036pg.postgres.database.azure.com',
    database: 'leya_talks',
    password: '@joke930731',
    port: 5432,
    ssl: { rejectUnauthorized: false }
});

client.connect();

export async function POST(req) {
    const { usernameOrEmail, password } = await req.json(); // 解析請求的 JSON 主體
    try {
        const result = await client.query(
            'SELECT username, nickname, password_hash FROM "users" WHERE username = $1 OR email = $2',
            [usernameOrEmail, usernameOrEmail]
        );
        const user = result.rows[0];

        if (user && user.password_hash === password) {
            return new Response(JSON.stringify({ message: '登入成功', nickname: user.nickname, id: user.username }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        } else {
            return new Response(JSON.stringify({ message: '帳號或密碼錯誤' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    } catch (err) {
        console.error('Query error', err.stack);
        return new Response(JSON.stringify({ message: '伺服器錯誤' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
