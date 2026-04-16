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
            // Emite de forma global para ChatWindow, ChatSection u otros componentes que ocupen inyectar la burbuja en vivo
            window.dispatchEvent(new CustomEvent('gateway_msg_upsert', { detail: payload }));
            
            // Replicar comportamiento SSE retroactivo para refrescar la lista de candidatos:
            // Al no conocer el candidateId, mandamos un pulso para que ChatSection relaje pero refresque localmente el número
            const jid = payload.remoteJid || payload.from || payload.sender || payload.id || '';
            const rawPhone = typeof jid === 'string' ? jid.split('@')[0] : '';
            
            if (rawPhone && isMounted) {
                // Generamos un "falso" updatedCandidate pero con una bandera extra de phoneMatch
                setUpdatedCandidate({
                     candidateId: payload.candidateId || null, 
                     phoneMatch: rawPhone,
                     updates: { ultimoMensaje: new Date().toISOString() } 
                });
            }
        };

        const handleUpdate = (payload) => {
            window.dispatchEvent(new CustomEvent('gateway_msg_update', { detail: payload }));
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
