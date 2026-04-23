import http from 'http';
import { IncomingForm } from 'formidable';
import fs from 'fs';

const server = http.createServer((req, res) => {
    if (req.method === 'POST') {
        const form = new IncomingForm({
            maxFileSize: 16 * 1024 * 1024,
            keepExtensions: true
        });
        form.parse(req, (err, fields, files) => {
            if (err) {
                res.writeHead(500);
                res.end(err.message);
                return;
            }
            try {
                const uploadedFile = files?.file?.[0] || files?.file;
                const filePath = uploadedFile.filepath;
                const fileBuffer = fs.readFileSync(filePath);
                res.writeHead(200);
                res.end(`Success: ${fileBuffer.length} bytes read from ${filePath}`);
            } catch (e) {
                res.writeHead(500);
                res.end(`Fail: ${e.message}`);
            }
        });
    } else {
        res.end('Send POST');
    }
});
server.listen(3000, () => console.log('Listening 3000'));
