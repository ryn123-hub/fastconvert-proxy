const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const crypto = require('crypto');
const admin = require('firebase-admin');

// Inisialisasi Firebase Admin dengan file lokal yang benar
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

app.post('/api/create-invoice', async (req, res) => {
    try {
        const { amount, invoiceNumber, email } = req.body;
        
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

        console.log("DOKU Checkout Response:", dokuData);

        if (dokuResponse.ok && dokuData.response?.payment?.url) {
            await db.collection('transactions').add({
                trxid: invoiceNumber,
                amount: Number(amount),
                email: email || "customer@mail.com",
                status: 'pending',
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
        console.error("API Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/', (req, res) => res.send("Fast Convert DOKU Server Running!"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server berjalan di port ${PORT}`));

