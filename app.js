const express = require('express');
const mysql = require('mysql2');
const bodyParser = require('body-parser');
const session = require('express-session');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'rahasia_nexus_market',
    resave: false,
    saveUninitialized: true
}));

// ================= KONEKSI DATABASE =================
const db = mysql.createConnection({
    host: 'localhost',
    port: 3307, // Port MySQL Anda
    user: 'root',
    password: 'gyan1234', // Password Anda
    database: 'nexus_market'
});

db.connect((err) => {
    if (err) console.error('❌ Database Error:', err.message);
    else console.log('✅ Database Terhubung!');
});

// ================= MIDDLEWARE CEK API KEY =================
const cekApiKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) return res.status(401).json({ message: 'API Key Kosong' });

    db.query('SELECT * FROM api_keys WHERE api_key = ?', [apiKey], (err, results) => {
        if (results.length > 0) {
            next(); 
        } else {
            res.status(403).json({ message: 'API Key Tidak Valid' });
        }
    });
};

// ================= AUTHENTICATION =================

app.post('/auth/login', (req, res) => {
    const { username, password } = req.body;
    db.query('SELECT * FROM users WHERE username = ? AND password = ?', [username, password], (err, results) => {
        if (results.length > 0) {
            req.session.user = results[0];
            res.json({ success: true, role: results[0].role });
        } else {
            res.json({ success: false, message: 'Login Gagal' });
        }
    });
});

app.get('/auth/me', (req, res) => {
    if (req.session.user) res.json({ loggedIn: true, user: req.session.user });
    else res.json({ loggedIn: false });
});

app.get('/auth/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// ================= KEY MANAGEMENT =================

app.get('/api/my-keys', (req, res) => {
    if (!req.session.user) return res.status(401).json([]);
    db.query('SELECT * FROM api_keys WHERE user_id = ? ORDER BY created_at DESC', 
    [req.session.user.id], (err, results) => {
        res.json(results);
    });
});

app.post('/api/create-key', (req, res) => {
    if (!req.session.user) return res.status(401).json({ message: 'Login dulu' });
    const { label } = req.body; 
    const newKey = 'nx-' + uuidv4().slice(0, 8); 

    db.query('INSERT INTO api_keys (user_id, key_label, api_key) VALUES (?, ?, ?)',
    [req.session.user.id, label, newKey], (err) => {
        if (err) return res.json({ success: false });
        res.json({ success: true, newKey: newKey });
    });
});

app.delete('/api/revoke-key/:id', (req, res) => {
    if (!req.session.user) return res.status(401).json({ message: 'Login dulu' });
    db.query('DELETE FROM api_keys WHERE id = ? AND user_id = ?', 
    [req.params.id, req.session.user.id], (err) => {
        res.json({ success: true });
    });
});

// ================= DATA PRODUCTS (OPEN API) =================

// 1. ENDPOINT LIST ALL (Lihat Semua Barang)
app.get('/api/v1/products', cekApiKey, (req, res) => {
    db.query('SELECT id, nama_produk, harga, stok, created_at FROM products', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({
            meta: { status: 'success', total: results.length },
            data: results
        });
    });
});

// 2. ENDPOINT SEARCH (Cari Barang) - [BARU DITAMBAHKAN]
// Akses: /api/v1/products/search?q=Laptop
app.get('/api/v1/products/search', cekApiKey, (req, res) => {
    const keyword = req.query.q; 

    if (!keyword) {
        return res.status(400).json({ status: 'error', message: 'Masukkan kata kunci! Contoh: ?q=Mouse' });
    }

    const sql = "SELECT * FROM products WHERE nama_produk LIKE ?";
    db.query(sql, [`%${keyword}%`], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        
        res.json({
            meta: { 
                status: 'success', 
                message: `Menampilkan hasil pencarian untuk '${keyword}'`,
                total: results.length 
            },
            data: results
        });
    });
});

// 3. ENDPOINT DETAIL (Lihat 1 Barang) - [BARU DITAMBAHKAN]
// Akses: /api/v1/products/detail/1
app.get('/api/v1/products/detail/:id', cekApiKey, (req, res) => {
    const id = req.params.id;

    db.query('SELECT * FROM products WHERE id = ?', [id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });

        if (results.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Produk tidak ditemukan' });
        }

        res.json({
            meta: { status: 'success' },
            data: results[0] 
        });
    });
});

// ================= ENDPOINT ADMIN =================
app.post('/api/products', (req, res) => { 
    // Fitur tambah produk (Admin) biarkan placeholder dulu atau isi jika sudah ada
    res.json({message: "Fitur Admin"});
});

// ============================================================
//                 ZONA KHUSUS ADMIN (BACKEND)
// ============================================================

// Middleware: Pastikan yang akses adalah ADMIN
const checkAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ message: 'Akses Ditolak: Khusus Admin!' });
    }
};

// 1. API STATISTIK DASHBOARD (Untuk Kartu Angka di Atas)
app.get('/api/admin/stats', checkAdmin, (req, res) => {
    const queryUsers = "SELECT COUNT(*) as total FROM users WHERE role='user'";
    const queryKeys = "SELECT COUNT(*) as total FROM api_keys";
    const queryProducts = "SELECT COUNT(*) as total FROM products";

    // Jalankan 3 query sekaligus (Parallel)
    db.query(queryUsers, (e1, r1) => {
        db.query(queryKeys, (e2, r2) => {
            db.query(queryProducts, (e3, r3) => {
                res.json({
                    users: r1[0].total,
                    keys: r2[0].total,
                    products: r3[0].total
                });
            });
        });
    });
});

// 2. API DAFTAR SEMUA USER (Tabel User)
app.get('/api/admin/users', checkAdmin, (req, res) => {
    // Kita Join dengan tabel api_keys untuk menghitung jumlah key per user
    const sql = `
        SELECT u.id, u.username, u.created_at, COUNT(k.id) as total_keys 
        FROM users u 
        LEFT JOIN api_keys k ON u.id = k.user_id 
        WHERE u.role = 'user' 
        GROUP BY u.id 
        ORDER BY u.created_at DESC`;

    db.query(sql, (err, results) => {
        res.json(results);
    });
});

// 3. API BAN USER (Hapus User)
app.delete('/api/admin/users/:id', checkAdmin, (req, res) => {
    const id = req.params.id;
    // Hapus user (Key miliknya otomatis terhapus karena settingan database CASCADE)
    db.query('DELETE FROM users WHERE id = ?', [id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// 4. API GLOBAL KEY MONITORING (Tabel Semua Key)
app.get('/api/admin/all-keys', checkAdmin, (req, res) => {
    // Join supaya kita tahu siapa pemilik key tersebut
    const sql = `
        SELECT k.id, k.key_label, k.api_key, k.created_at, u.username 
        FROM api_keys k 
        JOIN users u ON k.user_id = u.id 
        ORDER BY k.created_at DESC`;

    db.query(sql, (err, results) => {
        res.json(results);
    });
});

// 5. API REVOKE KEY (Hapus Key User Lain)
app.delete('/api/admin/revoke/:id', checkAdmin, (req, res) => {
    db.query('DELETE FROM api_keys WHERE id = ?', [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// ... (Kode endpoint stats, users, keys yang lama biarkan saja) ...

// 6. API UPDATE PRODUK (Edit Harga/Stok) - [BARU]
app.put('/api/admin/products/:id', checkAdmin, (req, res) => {
    const { nama_produk, harga, stok } = req.body;
    const id = req.params.id;

    const sql = "UPDATE products SET nama_produk=?, harga=?, stok=? WHERE id=?";
    db.query(sql, [nama_produk, harga, stok, id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, message: "Produk berhasil diupdate" });
    });
});

// 7. API DELETE PRODUK (Pastikan ini ada)
app.delete('/api/admin/products/:id', checkAdmin, (req, res) => {
    db.query('DELETE FROM products WHERE id = ?', [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// 8. API TAMBAH PRODUK (Khusus Admin)
app.post('/api/admin/products', checkAdmin, (req, res) => { // Perhatikan URL-nya saya rapikan jadi /api/admin/...
    const { nama_produk, harga, stok } = req.body;
    db.query('INSERT INTO products (nama_produk, harga, stok) VALUES (?, ?, ?)', 
    [nama_produk, harga, stok], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// 9. API LIST PRODUK KHUSUS ADMIN (Lihat Semua Produk)
// Ini endpoint baru biar Admin bisa lihat tabel tanpa API Key
app.get('/api/admin/products', checkAdmin, (req, res) => {
    // Urutkan dari yang terbaru (ID DESC) biar produk baru muncul paling atas
    db.query('SELECT * FROM products ORDER BY id DESC', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// START SERVER
app.listen(PORT, () => console.log(`🚀 Server Updated: http://localhost:${PORT}`));