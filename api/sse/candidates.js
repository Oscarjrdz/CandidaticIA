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

            // Check for new candidate signal
            const latestCandidate = await redis.get('sse_new_candidate');

            if (latestCandidate) {
                const candidate = JSON.parse(latestCandidate);

                // Only send if this is new (within last 5 seconds)
                const candidateTime = new Date(candidate.timestamp || 0).getTime();
                if (candidateTime > lastCheck) {
                    sendEvent({
                        type: 'candidate:new',
                        data: candidate
                    });
                    lastCheck = Date.now();
                }
            }
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
