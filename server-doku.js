const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const crypto = require('crypto');
const admin = require('firebase-admin');

const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://starseven-81e63-default-rtdb.asia-southeast1.firebasedatabase.app"
});

const db = admin.firestore();
const app = express();

app.use(cors());
app.use(express.json());

const DOKU_CLIENT_ID = "BRN-0216-1793357283385";
const DOKU_SECRET_KEY = "SK-Cu7TWcp0DGUeUBKyj7vu";
const DOKU_BASE_URL = "https://api.doku.com"; 

// Endpoint Pembuatan Invoice DOKU (Top-Up)
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
            return res.status(500).json({ success: false, message: "DOKU merespons dengan format tidak valid." });
        }

        if (dokuResponse.ok && dokuData.response?.payment?.url) {
            await db.collection('transactions').add({
                trxid: invoiceNumber,
                userId: userId || "",
                amount: Number(amount),
                email: email || "customer@mail.com",
                status: 'diproses',
                type: 'Top-Up Saldo',
                detail: `Top-up Saldo via DOKU (Inv: ${invoiceNumber})`,
                createdAt: new Date().toISOString()
            });

            return res.status(200).json({ 
                success: true, 
                paymentUrl: dokuData.response.payment.url 
            });
        } else {
            return res.status(500).json({ success: false, message: dokuData.error?.message || "Gagal membuat tautan DOKU." });
        }
    } catch (error) {
        console.error("API Create Invoice Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

// Endpoint Webhook DOKU (Notifikasi Otomatis & Tambah Saldo)
app.post('/api/doku-notification', async (req, res) => {
    try {
        const notification = req.body;
        
        const invoiceNumber = notification.order?.invoice_number || notification.trxid || notification.invoice_number;
        const transactionStatus = notification.transaction?.status || notification.status;

        if (!invoiceNumber) {
            return res.status(400).json({ success: false, message: "Invoice number tidak ditemukan." });
        }

        const txQuery = await db.collection('transactions').where('trxid', '==', invoiceNumber).get();
        if (txQuery.empty) {
            return res.status(200).json({ success: true, message: "Transaksi tidak ditemukan di database, diabaikan." });
        }

        const txDoc = txQuery.docs[0];
        const txData = txDoc.data();

        if (txData.status === 'selesai') {
            return res.status(200).json({ success: true, message: "Sudah diproses sebelumnya." });
        }

        const statusUpper = String(transactionStatus || "").toUpperCase();
        if (statusUpper === 'SUCCESS' || statusUpper === 'SUKSES' || statusUpper === 'PAJ' || statusUpper === 'SUCCESSFUL') {
            const amount = Number(txData.amount || 0);
            const userEmail = txData.email;
            const targetUserId = txData.userId;

            let userDocRef = null;
            let currentBalance = 0;

            // 1. LAKUKAN SEMUA PEMBACAAN (READ) DI LUAR TRANSAKSI
            if (targetUserId) {
                userDocRef = db.collection('users').doc(targetUserId);
                const userDoc = await userDocRef.get();
                if (userDoc.exists) {
                    currentBalance = Number(userDoc.data().balance || 0);
                }
            } else if (userEmail) {
                const userQuery = await db.collection('users').where('email', '==', userEmail).get();
                if (!userQuery.empty) {
                    userDocRef = userQuery.docs[0].ref;
                    const userDoc = await userDocRef.get();
                    if (userDoc.exists) {
                        currentBalance = Number(userDoc.data().balance || 0);
                    }
                }
            }

            // 2. LAKUKAN PENULISAN (WRITE) DI DALAM TRANSAKSI
            await db.runTransaction(async (transaction) => {
                transaction.update(txDoc.ref, {
                    status: 'selesai',
                    detail: `Top-up Saldo via DOKU Berhasil`,
                    updatedAt: new Date().toISOString()
                });

                if (userDocRef) {
                    transaction.update(userDocRef, {
                        balance: currentBalance + amount,
                        updatedAt: new Date().toISOString()
                    });
                }
            });

            return res.status(200).json({ success: true, message: "Webhook sukses diproses." });
        } else {
            await txDoc.ref.update({
                status: 'ditolak',
                updatedAt: new Date().toISOString()
            });
            return res.status(200).json({ success: true, message: "Status transaksi bukan sukses." });
        }
    } catch (error) {
        console.error("Webhook Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

// Endpoint untuk Cek Status Transaksi DOKU secara Manual (Tombol Tinjau Ulang)
app.post('/api/check-status', async (req, res) => {
    try {
        const { invoiceNumber } = req.body;
        if (!invoiceNumber) {
            return res.status(400).json({ success: false, message: "Invoice number diperlukan." });
        }

        // Cari transaksi di Firestore
        const txQuery = await db.collection('transactions').where('trxid', '==', invoiceNumber).get();
        if (txQuery.empty) {
            return res.status(404).json({ success: false, message: "Transaksi tidak ditemukan." });
        }

        const txDoc = txQuery.docs[0];
        const txData = txDoc.data();

        // Jika sudah selesai, langsung kembalikan sukses
        if (txData.status === 'selesai') {
            return res.status(200).json({ success: true, status: 'selesai', message: "Transaksi sudah selesai." });
        }

        // Query ke API DOKU untuk cek status pembayaran terkini
        const endpoint = `/checkout/v1/payment/status/${invoiceNumber}`;
        const requestTimestamp = new Date().toISOString().slice(0, 19) + "Z";
        const requestId = "REQ-CHECK-" + Date.now();

        const signatureRawData = `Client-Id:${DOKU_CLIENT_ID}\nRequest-Id:${requestId}\nRequest-Timestamp:${requestTimestamp}\nRequest-Target:${endpoint}`;
        const signatureHmac = crypto.createHmac('sha256', DOKU_SECRET_KEY).update(signatureRawData).digest('base64');
        const signature = `HMACSHA256=${signatureHmac}`;

        const dokuResponse = await fetch(`${DOKU_BASE_URL}${endpoint}`, {
            method: 'GET',
            headers: {
                'Client-Id': DOKU_CLIENT_ID,
                'Request-Id': requestId,
                'Request-Timestamp': requestTimestamp,
                'Request-Target': endpoint,
                'Signature': signature
            }
        });

        const responseText = await dokuResponse.text();
        let dokuData;
        try {
            dokuData = JSON.parse(responseText);
        } catch (e) {
            return res.status(500).json({ success: false, message: "Gagal memparsing respons dari DOKU." });
        }

        const trxStatus = dokuData.transaction?.status || dokuData.status;
        const statusUpper = String(trxStatus || "").toUpperCase();

        // Jika di DOKU sudah SUKSES, update database & tambahkan saldo
        if (statusUpper === 'SUCCESS' || statusUpper === 'SUKSES' || statusUpper === 'PAJ' || statusUpper === 'SUCCESSFUL') {
            const amount = Number(txData.amount || 0);
            const userEmail = txData.email;
            const targetUserId = txData.userId;

            let userDocRef = null;
            let currentBalance = 0;

            if (targetUserId) {
                userDocRef = db.collection('users').doc(targetUserId);
                const userDoc = await userDocRef.get();
                if (userDoc.exists) currentBalance = Number(userDoc.data().balance || 0);
            } else if (userEmail) {
                const userQuery = await db.collection('users').where('email', '==', userEmail).get();
                if (!userQuery.empty) {
                    userDocRef = userQuery.docs[0].ref;
                    const userDoc = await userDocRef.get();
                    if (userDoc.exists) currentBalance = Number(userDoc.data().balance || 0);
                }
            }

            await db.runTransaction(async (transaction) => {
                transaction.update(txDoc.ref, {
                    status: 'selesai',
                    detail: `Top-up Saldo via DOKU Berhasil (Ditinjau Ulang)`,
                    updatedAt: new Date().toISOString()
                });

                if (userDocRef) {
                    transaction.update(userDocRef, {
                        balance: currentBalance + amount,
                        updatedAt: new Date().toISOString()
                    });
                }
            });

            return res.status(200).json({ success: true, status: 'selesai', message: "Pembayaran terkonfirmasi berhasil! Saldo telah ditambahkan." });
        } else {
            return res.status(200).json({ success: true, status: 'diproses', message: "Pembayaran belum diselesaikan atau masih diproses oleh DOKU." });
        }
    } catch (error) {
        console.error("Check Status Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/', (req, res) => res.send("Fast Convert DOKU Server Active!"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`DOKU Server running on port ${PORT}`));

