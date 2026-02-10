/**
 * Server-Sent Events (SSE) Endpoint for Real-Time Candidate Updates
 * Uses Node.js runtime for Redis compatibility
 * Streams new candidate events to connected clients
 */

import { getRedisClient } from '../utils/storage.js';

// Node.js runtime for Redis support
export const config = {
    api: {
        bodyParser: false,
        responseLimit: false,
    }
};

export default async function handler(req, res) {
    // Only accept GET for SSE
    if (req.method !== 'GET') {
        return res.status(405).send('Method not allowed');
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

    // Send SSE event helper
    const sendEvent = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Send initial connection success
    sendEvent({ type: 'connected', timestamp: new Date().toISOString() });

    // Keep-alive ping every 30s
    const keepAliveInterval = setInterval(() => {
        res.write(': ping\n\n');
    }, 30000);

    // Get Redis client
    const redis = getRedisClient();
    let lastCheck = Date.now();

    // Polling loop
    const pollInterval = setInterval(async () => {
        try {
            if (!redis) return;

            // 🏎️ 1. Real-time Candidate Signal (New Candidates)
            const latestCandidate = await redis.get('sse_new_candidate');
            if (latestCandidate) {
                const candidate = JSON.parse(latestCandidate);
                const candidateTime = new Date(candidate.timestamp || 0).getTime();
                if (candidateTime > lastCheck) {
                    sendEvent({
                        type: 'candidate:new',
                        data: candidate
                    });
                    lastCheck = Date.now();
                }
            }

            // 🏎️ 2. Global Stats Signal (Table and Badge reactivity)
            const incoming = await redis.get('stats:msg:incoming') || '0';
            const outgoing = await redis.get('stats:msg:outgoing') || '0';

            // source of truth for table re-polling
            const totalVal = await redis.zcard('candidates:list');

            const complete = await redis.get('stats:bot:complete');
            const pending = await redis.get('stats:bot:pending');
            const lastFullCalc = await redis.get('stats:bot:last_calc');

            // Trigger background calculation if stale (5 mins)
            const now = Date.now();
            if (complete === null || pending === null || !lastFullCalc || (now - parseInt(lastFullCalc)) > 300000) {
                import('../utils/bot-stats.js').then(m => m.calculateBotStats()).catch(() => { });
                // We set a temporary flag to avoid spamming the import
                await redis.set('stats:bot:last_calc', now.toString(), 'EX', 60);
            }

            sendEvent({
                type: 'stats:global',
                data: {
                    incoming: parseInt(incoming),
                    outgoing: parseInt(outgoing),
                    total: totalVal,
                    complete: parseInt(complete || '0'),
                    pending: parseInt(pending || '0'),
                    flightPlan: await redis.get('stats:bot:flight_plan').then(res => res ? JSON.parse(res) : null).catch(() => null)
                }
            });

        } catch (error) {
            console.error('SSE poll error:', error);
        }
    }, 2000); // Poll every 2 seconds

    // Clean up on client disconnect
    req.on('close', () => {
        clearInterval(keepAliveInterval);
        clearInterval(pollInterval);
        res.end();
    });
}
