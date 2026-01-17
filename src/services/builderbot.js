/**
 * Servicio para interactuar con la API de BuilderBot
 * Base URL: https://app.builderbot.cloud/api/v2
 */

const BASE_URL = 'https://app.builderbot.cloud/api/v2';

/**
 * Mensajes de error en español según código HTTP
 */
const getErrorMessage = (status, defaultMessage) => {
    const errorMessages = {
        400: 'Solicitud inválida. Verifica los datos enviados.',
        401: 'API Key inválida o no autorizada.',
        403: 'Acceso prohibido. Verifica tus permisos.',
        404: 'Bot ID no encontrado. Verifica que sea correcto.',
        429: 'Demasiadas solicitudes. Intenta de nuevo en unos minutos.',
        500: 'Error del servidor de BuilderBot. Intenta más tarde.',
        503: 'Servicio no disponible temporalmente.',
    };

    return errorMessages[status] || defaultMessage || 'Error desconocido';
};

/**
 * Verificar conexión con BuilderBot
 * GET /api/v2/{botId}/webhook
 */
export const verifyConnection = async (botId, apiKey) => {
    try {
        const response = await fetch(`${BASE_URL}/${botId}/webhook`, {
            method: 'GET',
            headers: {
                'x-api-builderbot': apiKey,
            },
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            return {
                success: false,
                status: response.status,
                error: getErrorMessage(response.status, 'Error al verificar conexión'),
                data: null,
            };
        }

        return {
            success: true,
            status: response.status,
            data: data,
            timestamp: new Date().toISOString(),
        };
    } catch (error) {
        return {
            success: false,
            status: 0,
            error: 'Error de red. Verifica tu conexión a internet.',
            data: null,
        };
    }
};

/**
 * Actualizar configuración de webhook
 * POST /api/v2/{botId}/webhook
 */
export const updateWebhook = async (botId, apiKey, url, headers = []) => {
    try {
        // Convertir headers array a objeto
        const headersObj = {};
        headers.forEach(header => {
            if (header.key && header.value) {
                headersObj[header.key] = header.value;
            }
        });

        const response = await fetch(`${BASE_URL}/${botId}/webhook`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-builderbot': apiKey,
            },
            body: JSON.stringify({
                url: url,
                headers: headersObj,
            }),
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            return {
                success: false,
                status: response.status,
                error: getErrorMessage(response.status, 'Error al actualizar webhook'),
                data: null,
            };
        }

        return {
            success: true,
            status: response.status,
            data: data,
            message: 'Webhook actualizado correctamente',
        };
    } catch (error) {
        return {
            success: false,
            status: 0,
            error: 'Error de red. Verifica tu conexión a internet.',
            data: null,
        };
    }
};

/**
 * Enviar mensaje de prueba
 * POST /api/v2/{botId}/messages
 */
export const sendTestMessage = async (botId, apiKey, number, message) => {
    try {
        const response = await fetch(`${BASE_URL}/${botId}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-builderbot': apiKey,
            },
            body: JSON.stringify({
                messages: {
                    content: message,
                },
                number: number,
                checkIfExists: false,
            }),
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            return {
                success: false,
                status: response.status,
                error: getErrorMessage(response.status, 'Error al enviar mensaje'),
                data: null,
            };
        }

        return {
            success: true,
            status: response.status,
            data: data,
            message: 'Mensaje enviado correctamente',
        };
    } catch (error) {
        return {
            success: false,
            status: 0,
            error: 'Error de red. Verifica tu conexión a internet.',
            data: null,
        };
    }
};

/**
 * Obtener información del bot
 * GET /api/v2/{botId}
 */
export const getBotInfo = async (botId, apiKey) => {
    try {
        const response = await fetch(`${BASE_URL}/${botId}`, {
            method: 'GET',
            headers: {
                'x-api-builderbot': apiKey,
            },
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            return {
                success: false,
                status: response.status,
                error: getErrorMessage(response.status, 'Error al obtener información del bot'),
                data: null,
            };
        }

        return {
            success: true,
            status: response.status,
            data: data,
        };
    } catch (error) {
        return {
            success: false,
            status: 0,
            error: 'Error de red. Verifica tu conexión a internet.',
            data: null,
        };
    }
};
