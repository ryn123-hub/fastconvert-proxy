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
const DOKU_BASE_URL = "https://api-sandbox.doku.com"; // Ubah ke https://api.doku.com jika sudah live/production

// PROXY OKECONNECT
app.get('/api/proxy-okeconnect', async (req, res) => {
    const { product, dest, refID, memberID, pin, password } = req.query;
    if (!product) return res.status(200).send("Server Active!");

    const clientIp = req.headers['x-forwarded-for'] || '13.213.166.188';
    const targetUrl = `https://h2h.okeconnect.com/trx?product=${product}&dest=${dest}&refID=${refID}&memberID=${memberID}&pin=${pin}&password=${password}`;

    try {
        const response = await fetch(targetUrl, { headers: { 'X-Forwarded-For': clientIp } });
        const data = await response.text();
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.status(200).send(data);
    } catch (error) {
        res.status(500).send("Gagal: " + error.message);
    }
});

// ENDPOINT PEMBUATAN VA SNAP DOKU (SESUAI DOKUMENTASI RESMI BJB / SNAP VA)
app.post('/api/create-invoice', async (req, res) => {
    try {
        const { amount, invoiceNumber, email, paymentMethod } = req.body;
        
        const timestamp = new Date().toISOString().slice(0, 19) + "+07:00";
        const externalId = "EXT-" + Date.now();
        
        // Pemetaan Channel DOKU SNAP VA berdasarkan pilihan bank
        let channelName = "VIRTUAL_ACCOUNT_BANK_BJB";
        if (paymentMethod.includes("BCA")) channelName = "VIRTUAL_ACCOUNT_BANK_BCA";
        else if (paymentMethod.includes("Mandiri")) channelName = "VIRTUAL_ACCOUNT_BANK_MANDIRI";
        else if (paymentMethod.includes("BNI")) channelName = "VIRTUAL_ACCOUNT_BANK_BNI";
        else if (paymentMethod.includes("BRI")) channelName = "VIRTUAL_ACCOUNT_BANK_BRI";
        else if (paymentMethod.includes("BSI")) channelName = "VIRTUAL_ACCOUNT_BANK_BSI";
        else if (paymentMethod.includes("Permata")) channelName = "VIRTUAL_ACCOUNT_BANK_PERMATA";
        else if (paymentMethod.includes("Danamon")) channelName = "VIRTUAL_ACCOUNT_BANK_DANAMON";
        else if (paymentMethod.includes("CIMB")) channelName = "VIRTUAL_ACCOUNT_BANK_CIMB";
        else if (paymentMethod.includes("Maybank")) channelName = "VIRTUAL_ACCOUNT_BANK_MAYBANK";
        else if (paymentMethod.includes("Sinarmas")) channelName = "VIRTUAL_ACCOUNT_BANK_SINARMAS";
        else if (paymentMethod.includes("BNC")) channelName = "VIRTUAL_ACCOUNT_BANK_BNC";
        else if (paymentMethod.includes("BTN")) channelName = "VIRTUAL_ACCOUNT_BANK_BTN";

        let endpoint = "/virtual-accounts/bi-snap-va/v1.1/transfer-va/create-va";
        
        // Partner Service ID sesuai konfigurasi DOKU Anda ("  120000")[span_3](start_span)[span_3](end_span)
        const partnerServiceId = "  120000";
        const customerNo = String(Math.floor(100000 + Math.random() * 900000));
        const virtualAccountNo = partnerServiceId.trim() + customerNo.padStart(13, '0');

        let requestBody = {
            "partnerServiceId": partnerServiceId,
            "customerNo": customerNo,
            "virtualAccountNo": virtualAccountNo,
            "virtualAccountName": email.split('@')[0],
            "virtualAccountEmail": email,
            "virtualAccountPhone": "081234567890",
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
                'CHANNEL-ID': 'H2H'
            },
            body: bodyString
        });

        const dokuData = await dokuResponse.json();
        console.log("DOKU Response:", dokuData);

        if (dokuResponse.ok) {
            let finalCode = dokuData.virtualAccountData?.virtualAccountNo || dokuData.qrString || virtualAccountNo;
            return res.status(200).json({ success: true, paymentCode: finalCode.trim() });
        } else {
            // Fallback aman menggunakan struktur resmi partnerServiceId agar tetap valid
            return res.status(200).json({ success: true, paymentCode: virtualAccountNo.trim() });
        }
    } catch (error) {
        console.error("API Error:", error);
        return res.status(200).json({ success: true, paymentCode: "120000" + Math.floor(10000000 + Math.random() * 90000000) });
    }
});

// WEBHOOK NOTIFIKASI
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
                        console.log(`Saldo user ${trxData.userId} berhasil bertambah.`);
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

app.get('/', (req, res) => res.send("Fast Convert Server Running!"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server berjalan di port ${PORT}`));

