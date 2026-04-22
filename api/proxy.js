import axios from 'axios';

export default async function handler(req, res) {
    const { url } = req.query;

    if (!url || !url.startsWith('http')) {
        return res.status(400).send('Invalid URL');
    }

    // Only allow proxying meta domains
    if (!url.includes('lookaside.fbsbx.com') && !url.includes('graph.facebook.com') && !url.includes('whatsapp.net')) {
        return res.redirect(url);
    }

    try {
        const token = process.env.META_ACCESS_TOKEN;
        
        const response = await axios.get(url, {
            headers: token ? { 'Authorization': `Bearer ${token}` } : {},
            responseType: 'stream',
            timeout: 30000
        });

        // Forward headers
        if (response.headers['content-type']) {
            res.setHeader('Content-Type', response.headers['content-type']);
        }
        if (response.headers['content-length']) {
            res.setHeader('Content-Length', response.headers['content-length']);
        }
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('Access-Control-Allow-Origin', '*');

        return response.data.pipe(res);

    } catch (error) {
        console.error('Error in /api/proxy:', error.message);
        return res.status(500).send('Proxy Error');
    }
}
