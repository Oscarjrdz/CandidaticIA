import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * React Hook for Server-Sent Events (SSE) real-time updates
 * Connects to SSE endpoint and listens for candidate events
 * 
 * IMPORTANT: Uses a monotonic counter to guarantee every SSE event
 * produces a unique state change — preventing React 18 batching
 * from swallowing intermediate updates.
 */
export function useCandidatesSSE() {
    const [newCandidate, setNewCandidate] = useState(null);
    const [updatedCandidate, setUpdatedCandidate] = useState(null);
    const [globalStats, setGlobalStats] = useState(null);
    const [connected, setConnected] = useState(false);
    const [error, setError] = useState(null);
    const eventSourceRef = useRef(null);
    const reconnectTimeoutRef = useRef(null);
    const seqRef = useRef(0); // Monotonic counter to force unique references

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
                        } else if (data.type === 'candidate:update') {
                            // 🚀 CRITICAL FIX: Stamp each update with a unique seq ID
                            // so React always sees a new object reference, even if
                            // two updates arrive for the same candidate in the same tick.
                            seqRef.current += 1;
                            const stamped = { ...data.data, _seq: seqRef.current };
                            console.log('🔄 Candidate update via SSE:', stamped.candidateId, 'seq:', stamped._seq);
                            setUpdatedCandidate(stamped);
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
