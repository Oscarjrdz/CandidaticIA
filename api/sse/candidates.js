/**
 * Server-Sent Events (SSE) Endpoint for Real-Time Candidate Updates
 * Compatible with Vercel Edge Runtime
 * Streams new candidate events to connected clients
 */

import { getRedisClient } from '../utils/storage.js';

// Use Edge Runtime for SSE support
export const config = {
    runtime: 'edge'
};

export default async function handler(req) {
    // Only accept GET for SSE
    if (req.method !== 'GET') {
        return new Response('Method not allowed', { status: 405 });
    }

    // Create a TransformStream for SSE
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();
    const encoder = new TextEncoder();

    // Send SSE event helper
    const sendEvent = async (data) => {
        const message = `data: ${JSON.stringify(data)}\n\n`;
        await writer.write(encoder.encode(message));
    };

    // Keep-alive ping every 30s to prevent timeout
    const keepAlive = setInterval(async () => {
        try {
            await writer.write(encoder.encode(': ping\n\n'));
        } catch (error) {
            clearInterval(keepAlive);
        }
    }, 30000);

    // Initialize connection
    (async () => {
        try {
            // Send initial connection success
            await sendEvent({ type: 'connected', timestamp: new Date().toISOString() });

            // Subscribe to Redis pubsub for candidate events
            const redis = getRedisClient();

            // Poll for Redis pubsub messages (Edge Runtime limitation)
            // In production, this would use Redis SUBSCRIBE, but Edge doesn't support it
            // So we'll use a different approach: check for a "latest_candidate" key

            let lastCheck = Date.now();

            while (true) {
                try {
                    // Check for new candidate signal every 2 seconds
                    const latestCandidate = await redis?.get('sse_new_candidate');

                    if (latestCandidate) {
                        const candidate = JSON.parse(latestCandidate);

                        // Only send if this is new (within last 5 seconds)
                        const candidateTime = new Date(candidate.timestamp || 0).getTime();
                        if (candidateTime > lastCheck) {
                            await sendEvent({
                                type: 'candidate:new',
                                data: candidate
                            });
                            lastCheck = Date.now();
                        }
                    }

                    // Wait 2 seconds before next check
                    await new Promise(resolve => setTimeout(resolve, 2000));
                } catch (pollError) {
                    console.error('SSE poll error:', pollError);
                    // Continue polling even on error
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
        } catch (error) {
            console.error('SSE error:', error);
        } finally {
            clearInterval(keepAlive);
            await writer.close();
        }
    })();

    // Return SSE response
    return new Response(stream.readable, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
        }
    });
}
