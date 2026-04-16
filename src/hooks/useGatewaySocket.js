import { useState, useEffect } from 'react';
import { io } from 'socket.io-client';

const GATEWAY_URL = 'wss://gatewaywapp-production.up.railway.app';
let socketInstance = null;

export function useGatewaySocket() {
    const [newCandidate, setNewCandidate] = useState(null);
    const [updatedCandidate, setUpdatedCandidate] = useState(null);
    const [globalStats, setGlobalStats] = useState(null);
    const [connected, setConnected] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        let isMounted = true;

        if (!socketInstance) {
            console.log('⚡ Initializing Gateway Socket.io connection...');
            try {
                socketInstance = io(GATEWAY_URL, {
                    transports: ['websocket'],
                    withCredentials: true,
                    reconnection: true,
                    reconnectionAttempts: Infinity,
                    reconnectionDelay: 1000,
                });
            } catch (err) {
                console.error('Socket init error:', err);
                if (isMounted) setError(err.message);
            }
        }

        const handleConnect = () => {
             console.log('🟢 Gateway Socket Connected!');
             if (isMounted) {
                 setConnected(true);
                 setError(null);
             }
        };

        const handleDisconnect = () => {
             console.log('🔴 Gateway Socket Disconnected');
             if (isMounted) setConnected(false);
        };

        const handleUpsert = (payload) => {
            console.log('📨 WS Upsert:', payload); // Debug 
            // Si el backend envuelve el contenido en "data" (ej: {event_type: '...', data: {...}})
            const safePayload = payload.data || payload; 
            
            // Emite de forma global para ChatWindow, ChatSection u otros componentes
            window.dispatchEvent(new CustomEvent('gateway_msg_upsert', { detail: safePayload }));
            
            const jid = safePayload.remoteJid || safePayload.from || safePayload.sender || safePayload.id || '';
            const rawPhone = typeof jid === 'string' ? jid.split('@')[0] : '';
            
            if (rawPhone && isMounted) {
                // Generamos un "falso" updatedCandidate pero con una bandera extra de phoneMatch
                setUpdatedCandidate({
                     candidateId: safePayload.candidateId || null, 
                     phoneMatch: rawPhone,
                     updates: { ultimoMensaje: new Date().toISOString() } 
                });
            }
        };

        const handleUpdate = (payload) => {
            const safePayload = payload.data || payload; 
            window.dispatchEvent(new CustomEvent('gateway_msg_update', { detail: safePayload }));
        };

        // Si ya estaba conectado para este montaje de componente
        if (socketInstance.connected && isMounted) {
            setConnected(true);
        }

        socketInstance.on('connect', handleConnect);
        socketInstance.on('disconnect', handleDisconnect);
        socketInstance.on('whatsapp_message_upsert', handleUpsert);
        socketInstance.on('whatsapp_message_update', handleUpdate);

        return () => {
            isMounted = false;
            // No hacemos socketInstance.disconnect() porque queremos mantenerlo global.
            // Solo desuscribimos los handlers de ESTA instancia del componente.
            socketInstance.off('connect', handleConnect);
            socketInstance.off('disconnect', handleDisconnect);
            socketInstance.off('whatsapp_message_upsert', handleUpsert);
            socketInstance.off('whatsapp_message_update', handleUpdate);
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
