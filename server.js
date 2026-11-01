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

// URL PRODUKSI UNTUK API PEMBUATAN TOKEN SESUAI DOKUMENTASI
const DOKU_BASE_URL = "https://api.doku.com"; 

// ENDPOINT PEMBUATAN TOKEN DOKU
app.post('/api/create-invoice', async (req, res) => {
    try {
        const { amount, invoiceNumber, email } = req.body;
        
        const requestId = "REQ-" + Date.now();
        
        // Format waktu UTC dalam ISO8601 UTC+0 sesuai dokumentasi
        const requestTimestamp = new Date().toISOString().slice(0, 19) + "Z";

        const requestBody = {
            "grant_type": "client_credentials",
            "valid_time": "360"
        };

        const endpoint = "/adv-core-api/partner/v1.0/token";
        const bodyString = JSON.stringify(requestBody);
        
        // Sesuai dokumentasi API Pembuatan Token menggunakan HMAC-SHA256 untuk signature-nya
        const digest = crypto.createHash('sha256').update(bodyString).digest('base64');
        const stringToSign = `Client-Id:${DOKU_CLIENT_ID}\nRequest-Id:${requestId}\nRequest-Timestamp:${requestTimestamp}\nRequest-Target:${endpoint}\nDigest:${digest}`;
        const signature = crypto.createHmac('sha256', DOKU_SECRET_KEY).update(stringToSign).digest('base64');

        const dokuResponse = await fetch(`${DOKU_BASE_URL}${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Client-Id': DOKU_CLIENT_ID,
                'Request-Id': requestId,
                'Request-Timestamp': requestTimestamp,
                'Signature': `HMACSHA256=${signature}`
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

        console.log("DOKU Token Response:", dokuData);

        if (dokuResponse.ok && dokuData.token) {
            // Simpan transaksi pending ke Firestore
            await db.collection('transactions').add({
                trxid: invoiceNumber,
                amount: Number(amount),
                email: email || "customer@mail.com",
                status: 'pending',
                createdAt: new Date().toISOString()
            });

            return res.status(200).json({ 
                success: true, 
                token: dokuData.token 
            });
        } else {
            return res.status(500).json({ success: false, message: dokuData.message || "Gagal mendapatkan token DOKU." });
        }
    } catch (error) {
        console.error("API Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/', (req, res) => res.send("Fast Convert DOKU Token Server Running!"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server berjalan di port ${PORT}`));

