const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const crypto = require('crypto');
const admin = require('firebase-admin');

const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const app = express();

app.use(cors());
app.use(express.json());

const DOKU_CLIENT_ID = "BRN-0216-1793357283385";
const DOKU_SECRET_KEY = "SK-Cu7TWcp0DGUeUBKyj7vu";
const DOKU_API_KEY = "doku_key_b0222d971c30474d9dbca1dbfb5f46ee";
const DOKU_BASE_URL = "https://api-sandbox.doku.com";

// ENDPOINT PEMBUATAN LINK CHECKOUT DOKU
app.post('/api/create-invoice', async (req, res) => {
    try {
        const { amount, invoiceNumber, email } = req.body;
        
        const requestId = "REQ-" + Date.now();
        const requestTimestamp = new Date().toISOString().slice(0, 19) + "Z";

        const requestBody = {
            "order": {
                "amount": Number(amount),
                "invoice_number": invoiceNumber,
                "currency": "IDR",
                "memo": "Top Up Saldo FastConvert"
            },
            "payment": {
                "payment_due_date": 1440
            },
            "customer": {
                "name": email ? email.split('@')[0] : "Customer",
                "email": email || "customer@mail.com"
            }
        };

        const endpoint = "/checkout/v1/payment";
        const bodyString = JSON.stringify(requestBody);
        const digest = crypto.createHash('sha256').update(bodyString).digest('base64');
        const stringToSign = `Client-Id:${DOKU_CLIENT_ID}\nRequest-Id:${requestId}\nRequest-Timestamp:${requestTimestamp}\nRequest-Target:${endpoint}\nDigest:${digest}`;
        const signature = crypto.createHmac('sha512', DOKU_SECRET_KEY).update(stringToSign).digest('base64');

        const dokuResponse = await fetch(`${DOKU_BASE_URL}${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Client-Id': DOKU_CLIENT_ID,
                'Request-Id': requestId,
                'Request-Timestamp': requestTimestamp,
                'Signature': `HMACSHA512=${signature}`
            },
            body: bodyString
        });

        // Mengambil teks respons terlebih dahulu untuk debugging jika terjadi error HTML dari DOKU
        const responseText = await dokuResponse.text();
        let dokuData;
        try {
            dokuData = JSON.parse(responseText);
        } catch (e) {
            console.error("DOKU Non-JSON Response:", responseText);
            return res.status(500).json({ success: false, message: "DOKU merespons dengan format yang tidak valid." });
        }

        console.log("DOKU Checkout Response:", dokuData);

        if (dokuResponse.ok && dokuData.response?.payment?.url) {
            return res.status(200).json({ 
                success: true, 
                paymentUrl: dokuData.response.payment.url 
            });
        } else {
            return res.status(500).json({ success: false, message: dokuData.error?.message || "Gagal membuat tautan pembayaran DOKU." });
        }
    } catch (error) {
        console.error("API Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

// WEBHOOK NOTIFIKASI DOKU (Otomatis Tambah Saldo Firebase)
app.post('/api/doku-notification', async (req, res) => {
    try {
        const notificationData = req.body;
        console.log("Webhook DOKU diterima:", notificationData);

        const trxId = notificationData.order?.invoice_number || notificationData.partnerReferenceNo;
        const paymentStatus = notificationData.transaction_status || notificationData.status;
        const paidAmount = Number(notificationData.amount || notificationData.order?.amount || 0);

        if (paymentStatus === 'SUCCESS' || paymentStatus === 'PAID') {
            const trxQuery = await db.collection('transactions').where('trxid', '==', trxId).get();
            if (!trxQuery.empty) {
                const trxDoc = trxQuery.docs[0];
                const trxData = trxDoc.data();
                if (trxData.status !== 'sukses') {
                    await trxDoc.ref.update({ status: 'sukses', updatedAt: new Date().toISOString() });
                    const userRef = db.collection('users').doc(trxData.userId);
                    const userSnap = await userRef.get();
                    if (userSnap.exists()) {
                        const currentBalance = Number(userSnap.data().balance || userSnap.data().saldo || 0);
                        const newBalance = currentBalance + (paidAmount || trxData.amount);
                        await userRef.update({ balance: newBalance, saldo: newBalance });
                        console.log(`Saldo user ${trxData.userId} berhasil bertambah otomatis.`);
                    }
                }
            }
        }
        return res.status(200).json({ status: "OK" });
    } catch (error) {
        console.error("Webhook Error:", error);
        return res.status(500).json({ error: error.message });
    }
});

app.get('/', (req, res) => res.send("Fast Convert DOKU Link Server Running!"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server berjalan di port ${PORT}`));

