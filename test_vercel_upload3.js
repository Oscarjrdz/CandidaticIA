import handler from './api/media/upload.js';
import http from 'http';
import fs from 'fs';
import FormData from 'form-data';
import axios from 'axios';

const server = http.createServer(async (req, res) => {
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

server.listen(3003, async () => {
    console.log('Test server running');
    const form = new FormData();
    form.append('file', fs.createReadStream('./package.json'));
    
    try {
        const response = await axios.post('http://localhost:3003', form, {
            headers: form.getHeaders()
        });
        console.log('Status:', response.status);
        console.log('Response:', response.data);
    } catch(e) {
        console.error('Axios error:', e.response ? e.response.data : e.message);
    }
    process.exit(0);
});
