const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const admin = require('firebase-admin');

// Inisialisasi Firebase Admin menggunakan file serviceAccountKey.json
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const app = express();

app.use(cors());
app.use(express.json());

// ==========================================
// 1. ENDPOINT PROXY H2H OKECONNECT
// ==========================================
app.get('/api/proxy-okeconnect', async (req, res) => {
    const { product, dest, refID, memberID, pin, password } = req.query;

    if (!product) {
        return res.status(200).send("Fast Convert Proxy Server is Active and Running!");
    }

    const clientIp = req.headers['x-forwarded-for'] || '13.213.166.188';
    const targetUrl = `https://h2h.okeconnect.com/trx?product=${product}&dest=${dest}&refID=${refID}&memberID=${memberID}&pin=${pin}&password=${password}`;

    try {
        const response = await fetch(targetUrl, {
            headers: {
                'X-Forwarded-For': clientIp
            }
        });
        const data = await response.text();
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.status(200).send(data);
    } catch (error) {
        res.status(500).send("Gagal menghubungkan ke server pusat: " + error.message);
    }
});

// ==========================================
// 2. ENDPOINT WEBHOOK / NOTIFIKASI DOKU
// ==========================================
// Daftarkan URL ini di DOKU Dashboard > Settings > Notifications
app.post('/api/doku-notification', async (req, res) => {
    try {
        const notificationData = req.body;
        console.log("Menerima notifikasi webhook dari DOKU:", notificationData);

        const trxId = notificationData.order?.invoice_number || notificationData.trxid;
        const paymentStatus = notificationData.transaction_status || notificationData.status;
        const paidAmount = Number(notificationData.amount || notificationData.order?.amount || 0);

        if (paymentStatus === 'SUCCESS' || paymentStatus === 'PAID') {
            const trxQuery = await db.collection('transactions').where('trxid', '==', trxId).get();
            
            if (!trxQuery.empty) {
                const trxDoc = trxQuery.docs[0];
                const trxData = trxDoc.data();

                if (trxData.status !== 'sukses') {
                    // Update status transaksi jadi sukses
                    await trxDoc.ref.update({
                        status: 'sukses',
                        updatedAt: new Date().toISOString()
                    });

                    // Tambahkan saldo otomatis ke user
                    const userRef = db.collection('users').doc(trxData.userId);
                    const userSnap = await userRef.get();

                    if (userSnap.exists()) {
                        const currentBalance = Number(userSnap.data().balance || 0);
                        const newBalance = currentBalance + paidAmount;

                        await userRef.update({
                            balance: newBalance
                        });

                        console.log(`Sukses: Saldo user ${trxData.userId} bertambah Rp ${paidAmount}`);
                    }
                }
            }
        }

        return res.status(200).json({ status: "OK" });
    } catch (error) {
        console.error("Gagal memproses webhook DOKU:", error);
        return res.status(500).json({ error: error.message });
    }
});

// Root check
app.get('/', (req, res) => {
    res.send("Fast Convert Unified Server (Okeconnect & DOKU Webhook) is Running!");
});

// Menjalankan Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server berjalan di port ${PORT}`);
});

