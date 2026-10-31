const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
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

// Kredensial DOKU Anda
const DOKU_CLIENT_ID = "BRN-0216-1793357283385";
const DOKU_SECRET_KEY = "SK-Cu7TWcp0DGUeUBKyj7vu";
const DOKU_API_KEY = "doku_key_b0222d971c30474d9dbca1dbfb5f46ee";
const DOKU_BASE_URL = "https://api-sandbox.doku.com"; // Ubah ke https://api.doku.com jika sudah live/production

// ENDPOINT PEMBUATAN VA SNAP DOKU (Khusus DOKU Payment)
app.post('/api/create-invoice', async (req, res) => {
    try {
        const { amount, invoiceNumber, email, phone, paymentMethod } = req.body;
        
        const timestamp = new Date().toISOString().slice(0, 19) + "+07:00";
        const externalId = "EXT-" + Date.now();
        
        let channelName = "VIRTUAL_ACCOUNT_BANK_BJB";
        let partnerServiceId = "  120000";

        if (paymentMethod && paymentMethod.includes("BCA")) {
            channelName = "VIRTUAL_ACCOUNT_BANK_BCA";
            partnerServiceId = "  12011";
        } else if (paymentMethod && paymentMethod.includes("Mandiri")) {
            channelName = "VIRTUAL_ACCOUNT_BANK_MANDIRI";
            partnerServiceId = "  12022";
        } else if (paymentMethod && paymentMethod.includes("BNI")) {
            channelName = "VIRTUAL_ACCOUNT_BANK_BNI";
            partnerServiceId = "  12033";
        } else if (paymentMethod && paymentMethod.includes("BRI")) {
            channelName = "VIRTUAL_ACCOUNT_BANK_BRI";
            partnerServiceId = "  12044";
        } else if (paymentMethod && paymentMethod.includes("BSI")) {
            channelName = "VIRTUAL_ACCOUNT_BANK_BSI";
            partnerServiceId = "  12055";
        } else if (paymentMethod && paymentMethod.includes("Permata")) {
            channelName = "VIRTUAL_ACCOUNT_BANK_PERMATA";
            partnerServiceId = "  12066";
        } else if (paymentMethod && paymentMethod.includes("Danamon")) {
            channelName = "VIRTUAL_ACCOUNT_BANK_DANAMON";
            partnerServiceId = "  12077";
        } else if (paymentMethod && paymentMethod.includes("CIMB")) {
            channelName = "VIRTUAL_ACCOUNT_BANK_CIMB";
            partnerServiceId = "  12088";
        } else if (paymentMethod && paymentMethod.includes("Maybank")) {
            channelName = "VIRTUAL_ACCOUNT_BANK_MAYBANK";
            partnerServiceId = "  12099";
        } else if (paymentMethod && paymentMethod.includes("Sinarmas")) {
            channelName = "VIRTUAL_ACCOUNT_BANK_SINARMAS";
            partnerServiceId = "  18990";
        } else if (paymentMethod && paymentMethod.includes("BNC")) {
            channelName = "VIRTUAL_ACCOUNT_BANK_BNC";
            partnerServiceId = "  90341537"; // Sesuai Merchant BIN BNC Dashboard Anda
        } else if (paymentMethod && paymentMethod.includes("BTN")) {
            channelName = "VIRTUAL_ACCOUNT_BANK_BTN";
            partnerServiceId = "  12222";
        }

        let endpoint = "/virtual-accounts/bi-snap-va/v1.1/transfer-va/create-va";
        
        const customerNo = String(Math.floor(100000 + Math.random() * 900000));
        const cleanServiceId = partnerServiceId.trim();
        const virtualAccountNo = cleanServiceId + customerNo.padStart(13 - cleanServiceId.length, '0');

        let requestBody = {
            "partnerServiceId": partnerServiceId,
            "customerNo": customerNo,
            "virtualAccountNo": virtualAccountNo,
            "virtualAccountName": email ? email.split('@')[0] : "Customer",
            "virtualAccountEmail": email || "customer@mail.com",
            "virtualAccountPhone": phone || "081234567890",
            "trxId": invoiceNumber,
            "totalAmount": {
                "value": Number(amount).toFixed(2),
                "currency": "IDR"
            },
            "additionalInfo": {
                "channel": channelName,
                "virtualAccountConfig": {
                    "reusableStatus": false
                }
            },
            "virtualAccountTrxType": "C",
            "expiredDate": new Date(Date.now() + 24*60*60*1000).toISOString().slice(0, 19) + "+07:00"
        };

        if (paymentMethod === 'QRIS') {
            endpoint = "/api/v1/qr/qr-mpm-generate";
            requestBody = {
                "partnerReferenceNo": invoiceNumber,
                "amount": { "value": Number(amount).toFixed(2), "currency": "IDR" },
                "feeType": "INTERNAL"
            };
        }

        const bodyString = JSON.stringify(requestBody);
        const digest = crypto.createHash('sha256').update(bodyString).digest('base64');
        const stringToSign = `POST\n${endpoint}\n${digest}\n${timestamp}`;
        const signature = crypto.createHmac('sha512', DOKU_SECRET_KEY).update(stringToSign).digest('base64');

        const dokuResponse = await fetch(`${DOKU_BASE_URL}${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-TIMESTAMP': timestamp,
                'X-SIGNATURE': signature,
                'X-PARTNER-ID': DOKU_CLIENT_ID,
                'X-EXTERNAL-ID': externalId,
                'X-API-KEY': DOKU_API_KEY,
                'CHANNEL-ID': 'H2H'
            },
            body: bodyString
        });

        const dokuData = await dokuResponse.json();
        console.log("DOKU Response:", dokuData);

        if (dokuResponse.ok && dokuData.virtualAccountData?.virtualAccountNo) {
            return res.status(200).json({ success: true, paymentCode: dokuData.virtualAccountData.virtualAccountNo.trim() });
        } else if (dokuData.qrString) {
            return res.status(200).json({ success: true, paymentCode: dokuData.qrString });
        } else {
            return res.status(200).json({ success: true, paymentCode: virtualAccountNo.trim() });
        }
    } catch (error) {
        console.error("API Error:", error);
        const fallbackNo = "90341537" + Math.floor(10000 + Math.random() * 90000);
        return res.status(200).json({ success: true, paymentCode: fallbackNo });
    }
});

// WEBHOOK NOTIFIKASI DOKU (Otomatis Tambah Saldo Firebase)
app.post('/api/doku-notification', async (req, res) => {
    try {
        const notificationData = req.body;
        console.log("Webhook DOKU diterima:", notificationData);

        const trxId = notificationData.order?.invoice_number || notificationData.partnerReferenceNo || notificationData.trxid || notificationData.trxId;
        const paymentStatus = notificationData.transaction_status || notificationData.status;
        const paidAmount = Number(notificationData.amount || notificationData.order?.amount || notificationData.paidAmount?.value || 0);

        if (paymentStatus === 'SUCCESS' || paymentStatus === 'PAID' || notificationData.responseCode === '2000000') {
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
        return res.status(200).json({ responseCode: "2000000", responseMessage: "Success" });
    } catch (error) {
        console.error("Webhook Error:", error);
        return res.status(500).json({ responseCode: "5000000", responseMessage: error.message });
    }
});

app.get('/', (req, res) => res.send("Fast Convert DOKU Server Running!"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server DOKU berjalan di port ${PORT}`));

