import { useState, useEffect, useRef } from 'react';

export function usePresence(user, activeSection) {
    const [onlineUsers, setOnlineUsers] = useState([]);
    const currentChatIdRef = useRef(null);

    // Provide a way for ChatWindow to report which chat we are in
    useEffect(() => {
        const handleChatChange = (e) => {
            currentChatIdRef.current = e.detail?.chatId || null;
            // Force immediate heartbeat when changing chat
            sendHeartbeat();
        };

        window.addEventListener('presence_chat_change', handleChatChange);
        return () => window.removeEventListener('presence_chat_change', handleChatChange);
    }, []);

    const sendHeartbeat = async () => {
        if (!user) return;
        try {
            const res = await fetch('/api/presence', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: user.id || user.whatsapp,
                    userName: user.name || user.nombre || 'Recruiter',
                    role: user.role || 'User',
                    currentChatId: currentChatIdRef.current
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

    useEffect(() => {
        if (!user) return;
        
        // Initial heartbeat
        sendHeartbeat();

        // Interval heartbeat every 10 seconds
        const id = setInterval(sendHeartbeat, 10000);
        return () => clearInterval(id);
    }, [user]);

    return { onlineUsers };
}
