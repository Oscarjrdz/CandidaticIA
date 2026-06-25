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

    // SSE headers must be sent immediately — streaming breaks if we delay for auth
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Accel-Buffering', 'no');

    const sendEvent = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Auth: validate token after headers are set (required for Vercel streaming)
    const token = req.query.token?.trim();
    const redis = getRedisClient();
    let userId = null;
    try {
        userId = token && redis ? await redis.get(`session:admin:${token}`) : null;
    } catch (_e) { /* Redis error — treat as unauthorized */ }

    if (!userId) {
        sendEvent({ type: 'unauthorized' });
        res.end();
        return;
    }

    sendEvent({ type: 'connected', timestamp: new Date().toISOString() });

    const keepAliveInterval = setInterval(() => {
        res.write(': ping\n\n');
    }, 30000);
    
    // 🚀 NEW: Dedicated subscriber client for Real-Time Pub/Sub
    let subscriber = null;
    try {
        subscriber = redis.duplicate();
        subscriber.subscribe('channel:sse:updates');
        subscriber.on('message', (channel, message) => {
            if (channel === 'channel:sse:updates') {
                try {
                    const update = JSON.parse(message);
                    const eventType = update.type || 'candidate:update';
                    // stats:global already has flat {total,complete,pending} in update.data
                    // — unwrap to match runPoll() format so frontend reads it correctly
                    const payload = eventType === 'stats:global' ? update.data : update;
                    sendEvent({ type: eventType, data: payload });
                } catch (err) {
                    console.error('SSE Pub/Sub parse error:', err);
                }
            }
        });
    } catch (e) {
        console.error('Failed to setup SSE subscriber:', e);
    }

    const runPoll = async () => {
        try {
            if (!redis) return;

            // 1. [SIN TANTO ROLLO] Instant Stats Signal
            // We use SCARD for O(1) performance. No heavy calculations here.
            const pipeline = redis.pipeline();
            pipeline.get('stats:msg:incoming');
            pipeline.get('stats:msg:outgoing');
            pipeline.scard('stats:list:complete');
            pipeline.scard('stats:list:pending');
            pipeline.scard('candidates:unread');

            const results = await pipeline.exec();

            const incoming   = results[0][1] || '0';
            const outgoing   = results[1][1] || '0';
            const complete   = results[2][1] || 0;
            const pending    = results[3][1] || 0;
            const unreadCount = parseInt(results[4][1]) || 0;

            sendEvent({
                type: 'stats:global',
                data: {
                    incoming: parseInt(incoming),
                    outgoing: parseInt(outgoing),
                    total:    complete + pending,
                    complete,
                    pending,
                    unread:   unreadCount,
                }
            });

        } catch (error) {
            console.error('SSE poll error:', error);
        }
    };

    // Execute once on connection to seed the UI — pub/sub handles all updates after that
    runPoll();

    req.on('close', () => {
        clearInterval(keepAliveInterval);
        if (subscriber) {
            subscriber.unsubscribe();
            subscriber.quit();
        }
        res.end();
    });
}
