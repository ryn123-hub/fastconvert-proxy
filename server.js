const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const crypto = require('crypto');
const admin = require('firebase-admin');

// Inisialisasi Firebase Admin dengan file serviceAccountKey.json
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://starseven-81e63-default-rtdb.asia-southeast1.firebasedatabase.app"
});

const db = admin.firestore();
const app = express();

app.use(cors());
app.use(express.json());

// Konfigurasi DOKU
const DOKU_CLIENT_ID = "BRN-0216-1793357283385";
const DOKU_SECRET_KEY = "SK-Cu7TWcp0DGUeUBKyj7vu";
const DOKU_BASE_URL = "https://api.doku.com"; 

// ==========================================
// 1. FITUR OKECONNECT PROXY
// ==========================================
app.get('/trx', async (req, res) => {
    try {
        const { product, dest, refID, memberID, pin, password } = req.query;

        if (!product || !dest) {
            return res.status(400).send("Parameter OkeConnect tidak lengkap.");
        }

        const clientIp = req.headers['x-forwarded-for'] || '13.213.166.188';
        const targetUrl = `https://h2h.okeconnect.com/trx?product=${product}&dest=${dest}&refID=${refID}&memberID=${memberID}&pin=${pin}&password=${password}`;

        const response = await fetch(targetUrl, {
            headers: {
                'X-Forwarded-For': clientIp
            }
        });
        const data = await response.text();

        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.status(200).send(data);
    } catch (error) {
        console.error("OkeConnect Proxy Error:", error);
        res.status(500).send("Gagal menghubungkan ke server pusat: " + error.message);
    }
});


// ==========================================
// 2. FITUR PEMBUATAN INVOICE DOKU (TOP UP)
// ==========================================
app.post('/api/create-invoice', async (req, res) => {
    try {
        const { amount, invoiceNumber, email, userId } = req.body;
        
        const requestId = "REQ-" + Date.now();
        const requestTimestamp = new Date().toISOString().slice(0, 19) + "Z";
        const endpoint = "/checkout/v1/payment";

        const requestBody = {
            "order": {
                "amount": Number(amount),
                "invoice_number": invoiceNumber,
                "currency": "IDR",
                "memo": "Top Up Saldo FastConvert"
            },
            "payment": {
                "payment_due_date": 60
            },
            "customer": {
                "name": email ? email.split('@')[0] : "Customer",
                "email": email || "customer@mail.com"
            }
        };

        const bodyString = JSON.stringify(requestBody);
        const sha256digest = crypto.createHash('sha256').update(bodyString).digest('base64');
        
        const signatureRawData = `Client-Id:${DOKU_CLIENT_ID}\nRequest-Id:${requestId}\nRequest-Timestamp:${requestTimestamp}\nRequest-Target:${endpoint}\nDigest:${sha256digest}`;
        const signatureHmac = crypto.createHmac('sha256', DOKU_SECRET_KEY).update(signatureRawData).digest('base64');
        const signature = `HMACSHA256=${signatureHmac}`;

        const dokuResponse = await fetch(`${DOKU_BASE_URL}${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Client-Id': DOKU_CLIENT_ID,
                'Request-Id': requestId,
                'Request-Timestamp': requestTimestamp,
                'Request-Target': endpoint,
                'Digest': sha256digest,
                'Signature': signature
            },
            body: bodyString
        });

        const responseText = await dokuResponse.text();
        let dokuData;
        try {
            dokuData = JSON.parse(responseText);
        } catch (e) {
            console.error("DOKU Non-JSON Response:", responseText);
            return res.status(500).json({ success: false, message: "DOKU merespons dengan format yang tidak valid." });
        }

        if (dokuResponse.ok && dokuData.response?.payment?.url) {
            // Simpan transaksi ke Firestore agar langsung masuk riwayat dengan status 'diproses' / pending
            await db.collection('transactions').add({
                trxid: invoiceNumber,
                userId: userId || "",
                amount: Number(amount),
                email: email || "customer@mail.com",
                status: 'diproses', // Menggunakan status konsisten 'diproses'
                type: 'Top-Up Saldo',
                detail: `Top-up Saldo via DOKU (Inv: ${invoiceNumber})`,
                createdAt: new Date().toISOString()
            });

            return res.status(200).json({ 
                success: true, 
                paymentUrl: dokuData.response.payment.url 
            });
        } else {
            return res.status(500).json({ success: false, message: dokuData.error?.message || "Gagal membuat tautan pembayaran DOKU." });
        }
    } catch (error) {
        console.error("API Create Invoice Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
});


// ==========================================
// 3. FITUR WEBHOOK DOKU (NOTIFIKASI OTOMATIS)
// ==========================================
app.post('/api/doku-notification', async (req, res) => {
    try {
        const notification = req.body;
        console.log("DOKU Notification Received:", JSON.stringify(notification, null, 2));

        const invoiceNumber = notification.order?.invoice_number || notification.trxid;
        const transactionStatus = notification.transaction?.status || notification.status;

        if (!invoiceNumber) {
            return res.status(400).json({ success: false, message: "Invoice number tidak ditemukan." });
        }

        const txQuery = await db.collection('transactions').where('trxid', '==', invoiceNumber).get();
        
        if (txQuery.empty) {
            return res.status(404).json({ success: false, message: "Transaksi tidak ditemukan." });
        }

        const txDoc = txQuery.docs[0];
        const txData = txDoc.data();

        if (txData.status === 'selesai') {
            return res.status(200).json({ success: true, message: "Transaksi sudah diproses sebelumnya." });
        }

        if (transactionStatus === 'SUCCESS' || transactionStatus === 'PAJ' || transactionStatus === 'SUCCESSFUL') {
            const amount = Number(txData.amount || 0);
            const userEmail = txData.email;
            const targetUserId = txData.userId;

            // Cari user berdasarkan userId atau email
            let userDocRef = null;
            if (targetUserId) {
                userDocRef = db.collection('users').doc(targetUserId);
            } else {
                const userQuery = await db.collection('users').where('email', '==', userEmail).get();
                if (!userQuery.empty) {
                    userDocRef = userQuery.docs[0].ref;
                }
            }

            await db.runTransaction(async (transaction) => {
                // 1. Update status transaksi menjadi 'selesai'
                transaction.update(txDoc.ref, {
                    status: 'selesai',
                    detail: `Top-up Saldo via DOKU Berhasil`,
                    updatedAt: new Date().toISOString()
                });

                // 2. Tambahkan saldo otomatis ke user
                if (userDocRef) {
                    const userDoc = await transaction.get(userDocRef);
                    if (userDoc.exists) {
                        const currentBalance = Number(userDoc.data().balance || 0);
                        const newBalance = currentBalance + amount;

                        transaction.update(userDocRef, {
                            balance: newBalance,
                            updatedAt: new Date().toISOString()
                        });
                    }
                }
            });

            console.log(`Top-up Rp ${amount} untuk ${userEmail} berhasil & saldo bertambah.`);
            return res.status(200).json({ success: true, message: "Webhook sukses diproses." });
        } else {
            await txDoc.ref.update({
                status: 'ditolak',
                updatedAt: new Date().toISOString()
            });
            return res.status(200).json({ success: true, message: "Status transaksi diperbarui menjadi ditolak." });
        }

    } catch (error) {
        console.error("Webhook Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

// Root Endpoint (Pesan sambutan aman, tidak akan masuk ke riwayat transaksi)
app.get('/', (req, res) => {
    res.send("Fast Convert Unified Server (OkeConnect & DOKU) is Active and Running!");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server berjalan di port ${PORT}`);
});

