export default function handler(req, res) {
    res.status(200).json({
        status: 'online',
        version: '1.1.0-V3-LIVE',
        timestamp: new Date().toISOString(),
        engine: 'Brenda Core V3'
    });
}
