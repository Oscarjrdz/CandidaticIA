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
                    sendEvent({ type: eventType, data: update });
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
            pipeline.get('stats:bot:unread_v2');

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

    // Execute once on connection to seed the UI, then every 5s to keep stats fresh
    runPoll();
    const statsPollInterval = setInterval(runPoll, 5000);

    req.on('close', () => {
        clearInterval(keepAliveInterval);
        clearInterval(statsPollInterval);
        if (subscriber) {
            subscriber.unsubscribe();
            subscriber.quit();
        }
        res.end();
    });
}
