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

export default async (req, res) => {
    if (req.method === 'POST') {
        const { usernameOrEmail, password } = req.body;
        try {
            const result = await client.query(
                'SELECT username, nickname, password_hash FROM "users" WHERE username = $1 OR email = $2',
                [usernameOrEmail, usernameOrEmail]
            );
            const user = result.rows[0];

            if (user && user.password_hash === password) {
                return res.json({ message: '登入成功', nickname: user.nickname, id: user.username });
            } else {
                return res.status(401).json({ message: '帳號或密碼錯誤' });
            }
        } catch (err) {
            console.error('Query error', err.stack);
            return res.status(500).json({ message: '伺服器錯誤' });
        }
    } else {
        res.setHeader('Allow', ['POST']);
        res.status(405).end(`Method ${req.method} Not Allowed`);
    }
};
