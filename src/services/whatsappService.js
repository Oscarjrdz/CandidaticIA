/**
 * Servicio para interactuar con la API de UltraMsg
 * Base URL: https://api.ultramsg.com
 */

const BASE_URL = 'https://api.ultramsg.com';

/**
 * Mensajes de error en español según código HTTP
 */
const getErrorMessage = (status, defaultMessage) => {
    const errorMessages = {
        400: 'Solicitud inválida. Verifica los datos enviados.',
        401: 'Token de UltraMsg inválido o no autorizado.',
        403: 'Acceso prohibido. Verifica tus permisos.',
        404: 'Instancia de UltraMsg no encontrada.',
        429: 'Demasiadas solicitudes en UltraMsg. Intenta más tarde.',
        500: 'Error del servidor de UltraMsg. Intenta más tarde.',
        503: 'Servicio de UltraMsg no disponible temporalmente.',
    };

    return errorMessages[status] || defaultMessage || 'Error desconocido';
};

/**
 * Verificar conexión con UltraMsg
 * GET /{instanceId}/instance/status
 */
export const verifyConnection = async (instanceId, token) => {
    try {
        const response = await fetch(`${BASE_URL}/${instanceId}/instance/status?token=${token}`, {
            method: 'GET',
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            return {
                success: false,
                status: response.status,
                error: getErrorMessage(response.status, 'Error al verificar conexión con UltraMsg'),
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
 * Enviar mensaje de prueba via UltraMsg
 * POST /{instanceId}/messages/chat
 */
export const sendTestMessage = async (instanceId, token, number, message) => {
    try {
        const response = await fetch(`${BASE_URL}/${instanceId}/messages/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                token: token,
                to: number,
                body: message
            }),
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            return {
                success: false,
                status: response.status,
                error: getErrorMessage(response.status, 'Error al enviar mensaje vía UltraMsg'),
                data: null,
            };
        }

        return {
            success: true,
            status: response.status,
            data: data,
            message: 'Mensaje de prueba enviado correctamente',
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
 * Obtener estadísticas de la instancia
 * GET /{instanceId}/instance/statistics
 */
export const getBotInfo = async (instanceId, token) => {
    try {
        const response = await fetch(`${BASE_URL}/${instanceId}/instance/statistics?token=${token}`, {
            method: 'GET',
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            return {
                success: false,
                status: response.status,
                error: getErrorMessage(response.status, 'Error al obtener estadísticas de UltraMsg'),
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
