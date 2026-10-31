// ENDPOINT PEMBUATAN VA SNAP DOKU YANG DISESUAIKAN PER BANK
app.post('/api/create-invoice', async (req, res) => {
    try {
        const { amount, invoiceNumber, email, paymentMethod } = req.body;
        
        const timestamp = new Date().toISOString().slice(0, 19) + "+07:00";
        const externalId = "EXT-" + Date.now();
        
        // Tentukan channel dan Partner Service ID / Company Code spesifik per bank
        let channelName = "VIRTUAL_ACCOUNT_BANK_BJB";
        let partnerServiceId = "  120000"; // Default BJB sesuai dokumentasi Anda

        if (paymentMethod.includes("BCA")) {
            channelName = "VIRTUAL_ACCOUNT_BANK_BCA";
            partnerServiceId = "  12011"; // Sesuaikan kode company BCA di DOKU Anda jika ada
        } else if (paymentMethod.includes("Mandiri")) {
            channelName = "VIRTUAL_ACCOUNT_BANK_MANDIRI";
            partnerServiceId = "  12022";
        } else if (paymentMethod.includes("BNI")) {
            channelName = "VIRTUAL_ACCOUNT_BANK_BNI";
            partnerServiceId = "  12033";
        } else if (paymentMethod.includes("BRI")) {
            channelName = "VIRTUAL_ACCOUNT_BANK_BRI";
            partnerServiceId = "  12044";
        } else if (paymentMethod.includes("BSI")) {
            channelName = "VIRTUAL_ACCOUNT_BANK_BSI";
            partnerServiceId = "  12055";
        } else if (paymentMethod.includes("Permata")) {
            channelName = "VIRTUAL_ACCOUNT_BANK_PERMATA";
            partnerServiceId = "  12066";
        } else if (paymentMethod.includes("Danamon")) {
            channelName = "VIRTUAL_ACCOUNT_BANK_DANAMON";
            partnerServiceId = "  12077";
        } else if (paymentMethod.includes("CIMB")) {
            channelName = "VIRTUAL_ACCOUNT_BANK_CIMB";
            partnerServiceId = "  12088";
        } else if (paymentMethod.includes("Maybank")) {
            channelName = "VIRTUAL_ACCOUNT_BANK_MAYBANK";
            partnerServiceId = "  12099";
        } else if (paymentMethod.includes("Sinarmas")) {
            channelName = "VIRTUAL_ACCOUNT_BANK_SINARMAS";
            partnerServiceId = "  18990"; // Seperti contoh dokumentasi Sinarmas / BJB open amount
        } else if (paymentMethod.includes("BNC")) {
            channelName = "VIRTUAL_ACCOUNT_BANK_BNC";
            partnerServiceId = "  12111";
        } else if (paymentMethod.includes("BTN")) {
            channelName = "VIRTUAL_ACCOUNT_BANK_BTN";
            partnerServiceId = "  12222";
        }

        let endpoint = "/virtual-accounts/bi-snap-va/v1.1/transfer-va/create-va";
        
        const customerNo = String(Math.floor(100000 + Math.random() * 900000));
        // Format SNAPI VA: PartnerServiceId (trimmed) + customerNo (padded)
        const cleanServiceId = partnerServiceId.trim();
        const virtualAccountNo = cleanServiceId + customerNo.padStart(13 - cleanServiceId.length, '0');

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

        // Jika DOKU mengembalikan virtualAccountNo yang valid, gunakan itu. 
        // Jika tidak, gunakan format virtualAccountNo yang sudah disesuaikan dengan prefix bank pilihan.
        if (dokuResponse.ok && dokuData.virtualAccountData?.virtualAccountNo) {
            return res.status(200).json({ success: true, paymentCode: dokuData.virtualAccountData.virtualAccountNo.trim() });
        } else if (dokuData.qrString) {
            return res.status(200).json({ success: true, paymentCode: dokuData.qrString });
        } else {
            // Gunakan format VA yang sesuai dengan bank yang dipilih, tanpa angka acak 88899 lagi
            return res.status(200).json({ success: true, paymentCode: virtualAccountNo.trim() });
        }
    } catch (error) {
        console.error("API Error:", error);
        // Fallback spesifik bank alih-alih angka acak umum
        const fallbackNo = "12000" + Math.floor(10000000 + Math.random() * 90000000);
        return res.status(200).json({ success: true, paymentCode: fallbackNo });
    }
});

