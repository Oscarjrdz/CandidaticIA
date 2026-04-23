import handler from './api/media/upload.js';
import http from 'http';
import fs from 'fs';
import FormData from 'form-data';

const server = http.createServer(async (req, res) => {
    // Mock the Vercel response object
    res.status = function(code) {
        this.statusCode = code;
        return this;
    };
    res.json = function(data) {
        this.setHeader('Content-Type', 'application/json');
        this.end(JSON.stringify(data));
    };
    await handler(req, res);
});

server.listen(3001, async () => {
    console.log('Test server running');
    const form = new FormData();
    form.append('file', fs.createReadStream('./package.json'));
    
    try {
        const response = await fetch('http://localhost:3001', {
            method: 'POST',
            body: form
        });
        const data = await response.json();
        console.log('Status:', response.status);
        console.log('Response:', data);
    } catch(e) {
        console.error(e);
    }
    process.exit(0);
});
