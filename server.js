const http = require('http');
const fetch = require('node-fetch');

const server = http.createServer(async (req, res) => {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    const params = urlObj.searchParams;
    
    const product = params.get('product');
    const dest = params.get('dest');
    const refID = params.get('refID');
    const memberID = params.get('memberID');
    const pin = params.get('pin');
    const password = params.get('password');

    if (!product) {
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Fast Convert Proxy Server is Active and Running!");
        return;
    }

    const targetUrl = `https://h2h.okeconnect.com/trx?product=${product}&dest=${dest}&refID=${refID}&memberID=${memberID}&pin=${pin}&password=${password}`;

    try {
        const response = await fetch(targetUrl);
        const data = await response.text();

        res.writeHead(200, {
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "text/plain; charset=utf-8"
        });
        res.end(data);
    } catch (error) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Gagal menghubungkan ke server pusat: " + error.message);
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Proxy server running on port ${PORT}`);
});
