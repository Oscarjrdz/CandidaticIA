import { calculateBotStats } from '../utils/bot-stats.js';

export default async function handler(req, res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendEvent = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Initial Send
    const initialStats = await calculateBotStats();
    if (initialStats) sendEvent(initialStats);

    // Poll every 30 seconds for stats (or use a pub/sub if volume increases)
    const interval = setInterval(async () => {
        const stats = await calculateBotStats();
        if (stats) sendEvent(stats);
    }, 30000);

    req.on('close', () => {
        clearInterval(interval);
        res.end();
    });
}
