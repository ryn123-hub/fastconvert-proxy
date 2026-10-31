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
const DOKU_BASE_URL = "https://api-sandbox.doku.com"; // Sesuaikan jika menggunakan environment live

// ENDPOINT PEMBUATAN SNAP VIRTUAL ACCOUNT
app.post('/api/create-invoice', async (req, res) => {
    try {
        const { amount, invoiceNumber, email } = req.body;
        
        const timestamp = new Date().toISOString().slice(0, 19) + "+07:00";
        const endpoint = "/virtual-accounts/v1/transfer-va/create-va";

        const requestBody = {
            "partnerReferenceNo": invoiceNumber,
            "amount": {
                "value": Number(amount).toFixed(2),
                "currency": "IDR"
            },
            "feeType": "TOM",
            "virtualAccountName": email ? email.split('@')[0] : "Customer",
            "virtualAccountEmail": email || "customer@mail.com",
            "expiredDate": new Date(Date.now() + 24*60*60*1000).toISOString()
        };

        const bodyString = JSON.stringify(requestBody);
        const minifiedBody = JSON.stringify(JSON.parse(bodyString));
        const sha256 = crypto.createHash('sha256').update(minifiedBody).digest('hex');
        const stringToSign = `POST:${endpoint}:${DOKU_API_KEY}:${sha256}:${timestamp}`;
        const signature = crypto.createHmac('sha512', DOKU_SECRET_KEY).update(stringToSign).digest('base64');

        const dokuResponse = await fetch(`${DOKU_BASE_URL}${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-TIMESTAMP': timestamp,
                'X-SIGNATURE': signature,
                'X-PARTNER-ID': DOKU_CLIENT_ID,
                'X-EXTERNAL-ID': "EX-" + Date.now(),
                'CHANNEL-ID': 'WEB'
            },
            body: minifiedBody
        });

        const responseText = await dokuResponse.text();
        let dokuData;
        try {
            dokuData = JSON.parse(responseText);
        } catch (e) {
            console.error("DOKU Non-JSON Response:", responseText);
            return res.status(500).json({ success: false, message: "DOKU merespons dengan format yang tidak valid." });
        }

        console.log("DOKU SNAP Response:", dokuData);

        if (dokuResponse.ok && (dokuData.responseCode === "2002700" || dokuData.virtualAccountData)) {
            const vaData = dokuData.virtualAccountData || dokuData;
            
            // Simpan transaksi ke Firestore
            await db.collection('transactions').add({
                trxid: invoiceNumber,
                amount: Number(amount),
                email: email || "customer@mail.com",
                status: 'pending',
                createdAt: new Date().toISOString()
            });

            return res.status(200).json({ 
                success: true, 
                virtualAccountNo: vaData.virtualAccountNo || vaData.partnerReferenceNo,
                paymentUrl: vaData.checkoutUrl || vaData.paymentUrl || null
            });
        } else {
            return res.status(500).json({ success: false, message: dokuData.responseMessage || "Gagal membuat Virtual Account DOKU." });
        }
    } catch (error) {
        console.error("API Error:", error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

// WEBHOOK NOTIFIKASI DOKU SNAP
app.post('/api/doku-notification', async (req, res) => {
    try {
        const notificationData = req.body;
        console.log("Webhook SNAP diterima:", notificationData);

        const trxId = notificationData.partnerReferenceNo;
        const paymentStatus = notificationData.transactionStatus || notificationData.status;
        const paidAmount = Number(notificationData.paidAmount?.value || notificationData.amount || 0);

        if (paymentStatus === '00' || paymentStatus === 'SUCCESS' || paymentStatus === 'PAID') {
            const trxQuery = await db.collection('transactions').where('trxid', '==', trxId).get();
            if (!trxQuery.empty) {
                const trxDoc = trxQuery.docs[0];
                const trxData = trxDoc.data();
                if (trxData.status !== 'sukses') {
                    await trxDoc.ref.update({ status: 'sukses', updatedAt: new Date().toISOString() });
                    
                    const userQuery = await db.collection('users').where('email', '==', trxData.email).get();
                    if (!userQuery.empty) {
                        const userDoc = userQuery.docs[0];
                        const currentBalance = Number(userDoc.data().balance || userDoc.data().saldo || 0);
                        const newBalance = currentBalance + (paidAmount || trxData.amount);
                        await userDoc.ref.update({ balance: newBalance, saldo: newBalance });
                        console.log(`Saldo user berhasil bertambah otomatis.`);
                    }
                }
            }
        }
        return res.status(200).json({ responseCode: "2000000", responseMessage: "Success" });
    } catch (error) {
        console.error("Webhook Error:", error);
        return res.status(500).json({ responseCode: "5000000", responseMessage: error.message });
    }
});

app.get('/', (req, res) => res.send("Fast Convert SNAP Server Running!"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server berjalan di port ${PORT}`));

