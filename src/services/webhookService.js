/**
 * Servicio para interactuar con las API serverless de webhooks
 */

const API_BASE = import.meta.env.PROD ? '' : 'http://localhost:3000';

/**
 * Obtiene la configuración del webhook (URL dinámica)
 */
export const getWebhookConfig = async () => {
    try {
        const response = await fetch(`${API_BASE}/api/config`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Error obteniendo configuración');
        }

        return {
            success: true,
            data: data
        };
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
};

/**
 * Obtiene eventos almacenados
 */
export const getEvents = async (limit = 50, offset = 0, type = null) => {
    try {
        const params = new URLSearchParams({
            limit: limit.toString(),
            offset: offset.toString()
        });

        if (type) {
            params.append('type', type);
        }

        const response = await fetch(`${API_BASE}/api/events?${params}`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Error obteniendo eventos');
        }

        return {
            success: true,
            events: data.events || [],
            count: data.count || 0,
            pagination: data.pagination
        };
    } catch (error) {
        return {
            success: false,
            error: error.message,
            events: [],
            count: 0
        };
    }
};

/**
 * Obtiene estadísticas de eventos
 */
export const getEventStats = async () => {
    try {
        const response = await fetch(`${API_BASE}/api/events?stats=true`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Error obteniendo estadísticas');
        }

        return {
            success: true,
            stats: data.stats
        };
    } catch (error) {
        return {
            success: false,
            error: error.message,
            stats: null
        };
    }
};

/**
 * Suscripción a eventos con polling
 */
export class EventSubscription {
    constructor(callback, interval = 5000) {
        this.callback = callback;
        this.interval = interval;
        this.intervalId = null;
        this.lastEventId = null;
    }

    start() {
        // Primera llamada inmediata
        this.poll();

        // Polling periódico
        this.intervalId = setInterval(() => {
            this.poll();
        }, this.interval);
    }

    async poll() {
        const result = await getEvents(50, 0);

        if (result.success && result.events.length > 0) {
            const latestEvent = result.events[0];

            // Solo notificar si hay eventos nuevos
            if (!this.lastEventId || latestEvent.id !== this.lastEventId) {
                this.lastEventId = latestEvent.id;
                this.callback(result.events);
            }
        }
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }
}

/**
 * Envía un evento de prueba al webhook (para testing)
 */
export const sendTestWebhook = async (eventType = 'status.ready') => {
    try {
        const testPayloads = {
            'status.ready': {
                event: 'status.ready',
                timestamp: new Date().toISOString(),
                botId: 'test-bot-id',
                status: 'ready'
            },
            'message.incoming': {
                event: 'message.incoming',
                timestamp: new Date().toISOString(),
                botId: 'test-bot-id',
                from: '521234567890',
                message: {
                    type: 'text',
                    content: 'Mensaje de prueba desde el frontend'
                }
            }
        };

        const payload = testPayloads[eventType] || testPayloads['status.ready'];

        const response = await fetch(`${API_BASE}/api/webhook`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-webhook-secret': 'candidatic-webhook-secret-2024' // En producción, no exponer esto
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Error enviando webhook de prueba');
        }

        return {
            success: true,
            data: data
        };
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
};
