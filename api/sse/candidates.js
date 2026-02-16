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
    if (req.method !== 'GET') return res.status(405).send('Method not allowed');

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Accel-Buffering', 'no');

    const sendEvent = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    sendEvent({ type: 'connected', timestamp: new Date().toISOString() });

    const keepAliveInterval = setInterval(() => {
        res.write(': ping\n\n');
    }, 30000);

    const redis = getRedisClient();
    let lastNewCheck = Date.now() - 5000; // Look back 5s initially
    let lastUpdateCheck = Date.now() - 5000;

    const pollInterval = setInterval(async () => {
        try {
            if (!redis) return;

            // 1. New Candidate Signal
            const latestCandidate = await redis.get('sse_new_candidate');
            if (latestCandidate) {
                const candidate = JSON.parse(latestCandidate);
                const candidateTime = new Date(candidate.timestamp || 0).getTime();
                if (candidateTime > lastNewCheck) {
                    sendEvent({ type: 'candidate:new', data: candidate });
                    lastNewCheck = candidateTime;
                }
            }

            // 2. Candidate Update Signal
            const latestUpdate = await redis.get('sse_candidate_update');
            if (latestUpdate) {
                const update = JSON.parse(latestUpdate);
                const updateTime = new Date(update.timestamp || 0).getTime();
                if (updateTime > lastUpdateCheck) {
                    sendEvent({ type: 'candidate:update', data: update });
                    lastUpdateCheck = updateTime;
                }
            }

            // 2. [SIN TANTO ROLLO] Instant Stats Signal
            // We use SCARD for O(1) performance. No heavy calculations here.
            const pipeline = redis.pipeline();
            pipeline.get('stats:msg:incoming');
            pipeline.get('stats:msg:outgoing');
            pipeline.scard('stats:list:complete');
            pipeline.scard('stats:list:pending');
            pipeline.get('stats:bot:flight_plan');
            pipeline.get('stats:bot:last_calc');

            const results = await pipeline.exec();

            const incoming = results[0][1] || '0';
            const outgoing = results[1][1] || '0';
            const complete = results[2][1] || 0;
            const pending = results[3][1] || 0;
            const flightPlan = results[4][1] ? JSON.parse(results[4][1]) : null;
            const lastCalc = results[5][1];

            // Trigger background flight plan update if stale (5 mins)
            const now = Date.now();
            if (!lastCalc || (now - parseInt(lastCalc)) > 300000) {
                import('../utils/bot-stats.js').then(m => m.calculateBotStats()).catch(() => { });
                await redis.set('stats:bot:last_calc', now.toString(), 'EX', 60);
            }

            sendEvent({
                type: 'stats:global',
                data: {
                    incoming: parseInt(incoming),
                    outgoing: parseInt(outgoing),
                    total: complete + pending,
                    complete: complete,
                    pending: pending,
                    flightPlan
                }
            });

        } catch (error) {
            console.error('SSE poll error:', error);
        }
    }, 2000);

    req.on('close', () => {
        clearInterval(keepAliveInterval);
        clearInterval(pollInterval);
        res.end();
    });
}
