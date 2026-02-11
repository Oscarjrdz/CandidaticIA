
import axios from 'axios';

export default async function handler(req, res) {
    const { text } = req.query;

    if (!text) {
        return res.status(400).send('Missing text');
    }

    try {
        const cleanText = text.substring(0, 200);
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(cleanText)}&tl=es&client=tw-ob`;

        const response = await axios({
            method: 'get',
            url: ttsUrl,
            responseType: 'stream',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });

        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24h
        response.data.pipe(res);

    } catch (error) {
        console.error('TTS Proxy Error:', error.message);
        res.status(500).send('Error generating TTS');
    }
}
