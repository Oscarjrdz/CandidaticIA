import { useState, useEffect, useRef } from 'react';

const IDLE_THRESHOLD_MS = 60_000; // 60s without activity = idle, stop counting time

export function usePresence(user, activeSection) {
    const [onlineUsers, setOnlineUsers] = useState([]);
    const currentChatIdRef = useRef(null);
    const lastActivityRef = useRef(Date.now());
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
            sendHeartbeatRef.current?.();
        };
        window.addEventListener('presence_chat_change', handleChatChange);
        return () => window.removeEventListener('presence_chat_change', handleChatChange);
    }, []);

    useEffect(() => {
        if (!user) return;

        const sendHeartbeat = async () => {
            if (!user) return;
            const isIdle = (Date.now() - lastActivityRef.current) > IDLE_THRESHOLD_MS;
            try {
                const res = await fetch('/api/presence', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        userId: user.id || user.whatsapp,
                        whatsapp: user.whatsapp,           // always present, used as stable identity
                        userName: user.name || user.nombre || 'Recruiter',
                        role: user.role || 'User',
                        currentChatId: currentChatIdRef.current,
                        idle: isIdle,
                    })
                });
                const data = await res.json();
                if (data.success && Array.isArray(data.onlineUsers)) {
                    setOnlineUsers(data.onlineUsers);
                }
            } catch (e) {
                console.error('Presence error:', e);
            }
        };

        sendHeartbeatRef.current = sendHeartbeat;

        // Initial heartbeat
        sendHeartbeat();

        // Heartbeat every 20s — presence sigue siendo en tiempo real vía SSE pub/sub.
        // El intervalo sólo actualiza lastSeen y chat activo (no crítico al segundo).
        const id = setInterval(sendHeartbeat, 20000);
        return () => clearInterval(id);
    }, [user]);

    return { onlineUsers };
}
