import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * React Hook for Server-Sent Events (SSE) real-time updates
 * Connects to SSE endpoint and listens for candidate events
 * 
 * ARCHITECTURE: Uses CustomEvent dispatch to guarantee EVERY SSE event
 * reaches consumers, bypassing React 18's automatic batching which
 * would swallow intermediate updates when using useState.
 * 
 * Consumers should use the `useSSEEvent` helper to subscribe.
 */

// ─── Global Event Bus (bypasses React batching) ───
const SSE_EVENTS = {
    CANDIDATE_UPDATE: 'sse:candidate:update',
    CANDIDATE_NEW: 'sse:candidate:new',
};

/**
 * Helper hook: Subscribe to SSE candidate update events.
 * Guarantees every single event fires the callback, unlike useState.
 * @param {Function} handler - Called with (data) for each SSE update
 * @param {Array} deps - Dependencies for the handler (like useEffect deps)
 */
export function useSSECandidateUpdate(handler, deps = []) {
    const handlerRef = useRef(handler);
    // Keep ref current without re-subscribing
    useEffect(() => { handlerRef.current = handler; });

    useEffect(() => {
        const listener = (e) => handlerRef.current(e.detail);
        window.addEventListener(SSE_EVENTS.CANDIDATE_UPDATE, listener);
        return () => window.removeEventListener(SSE_EVENTS.CANDIDATE_UPDATE, listener);
    }, []); // Subscribe once, ref keeps handler current
}

export function useCandidatesSSE() {
    const [newCandidate, setNewCandidate] = useState(null);
    // updatedCandidate kept for backward-compat with simple consumers
    // (ProjectsSection, CandidatesSection) that only need "latest" value
    const [updatedCandidate, setUpdatedCandidate] = useState(null);
    const [globalStats, setGlobalStats] = useState(null);
    const [connected, setConnected] = useState(false);
    const [error, setError] = useState(null);
    const eventSourceRef = useRef(null);
    const reconnectTimeoutRef = useRef(null);

    useEffect(() => {
        let isMounted = true;

        const connect = () => {
            try {
                // Create EventSource connection
                const eventSource = new EventSource('/api/sse/candidates');
                eventSourceRef.current = eventSource;

                eventSource.onopen = () => {
                    if (isMounted) {
                        console.log('✅ SSE connected');
                        setConnected(true);
                        setError(null);
                    }
                };

                eventSource.addEventListener('message', (event) => {
                    if (!isMounted) return;

                    try {
                        const data = JSON.parse(event.data);

                        if (data.type === 'connected') {
                            console.log('📡 SSE connection established');
                        } else if (data.type === 'candidate:new') {
                            console.log('🆕 New candidate via SSE:', data.data);
                            setNewCandidate(data.data);
                            window.dispatchEvent(new CustomEvent(SSE_EVENTS.CANDIDATE_NEW, { detail: data.data }));
                        } else if (data.type === 'candidate:update') {
                            console.log('🔄 Candidate update via SSE:', data.data?.candidateId);
                            // 🚀 CRITICAL: Dispatch via DOM CustomEvent to bypass React 18 batching.
                            // This guarantees EVERY update fires the consumer's handler,
                            // even when multiple SSE events arrive in the same tick.
                            window.dispatchEvent(new CustomEvent(SSE_EVENTS.CANDIDATE_UPDATE, { detail: data.data }));
                            // Also set state for backward-compat (simple consumers that only need latest)
                            setUpdatedCandidate(data.data);
                        } else if (data.type === 'stats:global') {
                            setGlobalStats(data.data);
                        }
                    } catch (parseError) {
                        console.error('SSE parse error:', parseError);
                    }
                });

                eventSource.onerror = (err) => {
                    console.error('❌ SSE error:', err);

                    if (isMounted) {
                        setConnected(false);
                        setError('Connection lost');

                        // Close and attempt reconnect after 5 seconds
                        eventSource.close();

                        reconnectTimeoutRef.current = setTimeout(() => {
                            if (isMounted) {
                                console.log('🔄 Reconnecting SSE...');
                                connect();
                            }
                        }, 5000);
                    }
                };
            } catch (err) {
                console.error('SSE connection error:', err);
                if (isMounted) {
                    setError(err.message);
                }
            }
        };

        // Initial connection
        connect();

        // Cleanup
        return () => {
            isMounted = false;

            if (eventSourceRef.current) {
                eventSourceRef.current.close();
            }

            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
            }
        };
    }, []);

    return {
        newCandidate,
        updatedCandidate,
        globalStats,
        connected,
        error
    };
}
