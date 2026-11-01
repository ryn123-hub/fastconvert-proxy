const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();

app.use(cors());
app.use(express.json());

// Proxy Endpoint OkeConnect H2H
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

app.get('/', (req, res) => res.send("Fast Convert OkeConnect Proxy Server Active!"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`OkeConnect Server running on port ${PORT}`));
