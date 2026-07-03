import { useState, useEffect, useRef } from 'react';

const IDLE_THRESHOLD_MS = 60_000; // 60s without activity = idle, stop counting time
const HEARTBEAT_INTERVAL_MS = 45_000;
const IDLE_HEARTBEAT_INTERVAL_MS = 4 * 60_000; // slower heartbeat while idle — same Redis cost shouldn't apply when nobody's actually working

export function usePresence(user) {
    const [onlineUsers, setOnlineUsers] = useState([]);
    const currentChatIdRef = useRef(null);
    const lastActivityRef = useRef(0);
    const lastHeartbeatAtRef = useRef(0);
    const sendHeartbeatRef = useRef(null);

    // Track real user activity — any of these resets the idle timer
    useEffect(() => {
        const onActivity = () => { lastActivityRef.current = Date.now(); };
        const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
        events.forEach(e => window.addEventListener(e, onActivity, { passive: true }));
        return () => events.forEach(e => window.removeEventListener(e, onActivity));
    }, []);

    // Listen for real-time presence pushes via SSE
    useEffect(() => {
        const handleSSE = (e) => {
            if (e.detail?.onlineUsers) setOnlineUsers(e.detail.onlineUsers);
        };
        window.addEventListener('sse:presence:update', handleSSE);
        return () => window.removeEventListener('sse:presence:update', handleSSE);
    }, []);

    // When recruiter changes chat, force an immediate heartbeat
    useEffect(() => {
        const handleChatChange = (e) => {
            currentChatIdRef.current = e.detail?.chatId || null;
            sendHeartbeatRef.current?.({ hydrate: true });
        };
        window.addEventListener('presence_chat_change', handleChatChange);
        return () => window.removeEventListener('presence_chat_change', handleChatChange);
    }, []);

    useEffect(() => {
        if (!user) return;

        const startTime = Date.now();
        lastActivityRef.current = startTime;
        lastHeartbeatAtRef.current = startTime;

        let timeoutId = null;
        let stopped = false;

        const sendHeartbeat = async ({ hydrate = false } = {}) => {
            if (!user) return false;
            const now = Date.now();
            const isIdle = (now - lastActivityRef.current) > IDLE_THRESHOLD_MS;
            const elapsedSeconds = Math.max(0, Math.round((now - lastHeartbeatAtRef.current) / 1000));
            lastHeartbeatAtRef.current = now;
            try {
                const res = await fetch(`/api/presence${hydrate ? '?hydrate=1' : '?lean=1'}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        userId: user.id || user.whatsapp,
                        whatsapp: user.whatsapp,           // always present, used as stable identity
                        userName: user.name || user.nombre || 'Recruiter',
                        role: user.role || 'User',
                        currentChatId: currentChatIdRef.current,
                        idle: isIdle,
                        activeSeconds: isIdle ? 0 : Math.min(elapsedSeconds, HEARTBEAT_INTERVAL_MS / 1000),
                    })
                });
                const data = await res.json();
                if (data.success && Array.isArray(data.onlineUsers)) {
                    setOnlineUsers(data.onlineUsers);
                }
            } catch (e) {
                console.error('Presence error:', e);
            }
            return isIdle;
        };

        sendHeartbeatRef.current = sendHeartbeat;

        // Heartbeat cada 45s mientras hay actividad real; se espacía a cada 4min
        // mientras el usuario queda idle (pestaña abierta pero nadie trabajando) —
        // mismo costo de Redis no debería aplicar si nadie está usando la app.
        const scheduleNext = (delayMs) => {
            if (stopped) return;
            timeoutId = setTimeout(async () => {
                const isIdle = await sendHeartbeat();
                scheduleNext(isIdle ? IDLE_HEARTBEAT_INTERVAL_MS : HEARTBEAT_INTERVAL_MS);
            }, delayMs);
        };

        // Initial heartbeat
        sendHeartbeat({ hydrate: true });
        scheduleNext(HEARTBEAT_INTERVAL_MS);

        return () => {
            stopped = true;
            if (timeoutId) clearTimeout(timeoutId);
        };
    }, [user]);

    return { onlineUsers };
}
