import { useState, useEffect, useRef, useCallback, useSyncExternalStore } from 'react';

/**
 * React Hook for Server-Sent Events (SSE) real-time updates
 * Connects to SSE endpoint and listens for candidate events
 * 
 * ARCHITECTURE (v3 — SINGLETON):
 * A single global EventSource connection is shared across ALL consumers.
 * This fixes the critical bug where multiple useCandidatesSSE() calls 
 * created multiple EventSource connections, each with its own server-side
 * polling loop doing destructive `redis.lpop('sse:updates')`. With N consumers,
 * each connection only received ~1/N of the events — causing messages to
 * silently disappear from the chat UI.
 *
 * All consumers now share the same connection via a module-level singleton.
 * DOM CustomEvents are dispatched for per-event delivery (bypassing React 18 batching).
 */

// ─── Global Event Bus (bypasses React batching) ───
const SSE_EVENTS = {
    CANDIDATE_UPDATE: 'sse:candidate:update',
    CANDIDATE_NEW: 'sse:candidate:new',
};

// ─── SINGLETON: Single global EventSource ───
let _singletonES = null;
let _singletonReconnectTimer = null;
let _subscriberCount = 0;
let _globalState = {
    newCandidate: null,
    updatedCandidate: null,
    globalStats: null,
    connected: false,
    error: null,
};
const _listeners = new Set();

function _notifyListeners() {
    _listeners.forEach(fn => fn());
}

function _updateState(patch) {
    _globalState = { ..._globalState, ...patch };
    _notifyListeners();
}

function _connectSingleton() {
    if (_singletonES) return; // Already connected

    try {
        const eventSource = new EventSource('/api/sse/candidates');
        _singletonES = eventSource;

        eventSource.onopen = () => {
            console.log('✅ SSE connected (singleton)');
            _updateState({ connected: true, error: null });
        };

        eventSource.addEventListener('message', (event) => {
            try {
                const data = JSON.parse(event.data);

                if (data.type === 'connected') {
                    console.log('📡 SSE connection established (singleton)');
                } else if (data.type === 'candidate:new') {
                    console.log('🆕 New candidate via SSE:', data.data);
                    _updateState({ newCandidate: data.data });
                    window.dispatchEvent(new CustomEvent(SSE_EVENTS.CANDIDATE_NEW, { detail: data.data }));
                } else if (data.type === 'candidate:update') {
                    console.log('🔄 Candidate update via SSE:', data.data?.candidateId);
                    // 🚀 CRITICAL: Dispatch via DOM CustomEvent to bypass React 18 batching.
                    window.dispatchEvent(new CustomEvent(SSE_EVENTS.CANDIDATE_UPDATE, { detail: data.data }));
                    // Also update state for backward-compat (simple consumers that only need latest)
                    _updateState({ updatedCandidate: data.data });
                } else if (data.type === 'stats:global') {
                    _updateState({ globalStats: data.data });
                }
            } catch (parseError) {
                console.error('SSE parse error:', parseError);
            }
        });

        eventSource.onerror = (err) => {
            console.error('❌ SSE error (singleton):', err);
            _updateState({ connected: false, error: 'Connection lost' });

            // Close and attempt reconnect
            eventSource.close();
            _singletonES = null;

            if (_subscriberCount > 0) {
                _singletonReconnectTimer = setTimeout(() => {
                    if (_subscriberCount > 0) {
                        console.log('🔄 Reconnecting SSE (singleton)...');
                        _connectSingleton();
                    }
                }, 5000);
            }
        };
    } catch (err) {
        console.error('SSE connection error:', err);
        _updateState({ error: err.message });
    }
}

function _disconnectSingleton() {
    if (_singletonES) {
        _singletonES.close();
        _singletonES = null;
    }
    if (_singletonReconnectTimer) {
        clearTimeout(_singletonReconnectTimer);
        _singletonReconnectTimer = null;
    }
    _updateState({ connected: false });
}

function _subscribe(listener) {
    _listeners.add(listener);
    _subscriberCount++;
    if (_subscriberCount === 1) {
        _connectSingleton();
    }
    return () => {
        _listeners.delete(listener);
        _subscriberCount--;
        if (_subscriberCount <= 0) {
            _subscriberCount = 0;
            _disconnectSingleton();
        }
    };
}

function _getSnapshot() {
    return _globalState;
}

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

/**
 * Main SSE hook — SINGLETON architecture.
 * No matter how many components call this, only ONE EventSource is created.
 */
export function useCandidatesSSE() {
    const state = useSyncExternalStore(_subscribe, _getSnapshot);

    return {
        newCandidate: state.newCandidate,
        updatedCandidate: state.updatedCandidate,
        globalStats: state.globalStats,
        connected: state.connected,
        error: state.error,
    };
}
