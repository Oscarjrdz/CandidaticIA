/**
 * Utilidades para validación de datos
 */

/**
 * Valida si el Instance ID de UltraMsg es válido
 */
export const validateInstanceId = (id) => {
    if (!id || typeof id !== 'string') {
        return { valid: false, error: 'El Instance ID es requerido' };
    }
    // Suelen ser números, pero los tratamos como strings
    if (id.length < 1) {
        return { valid: false, error: 'El Instance ID no es válido' };
    }
    return { valid: true };
};

/**
 * Valida si el Token de UltraMsg tiene el formato correcto
 */
export const validateToken = (token) => {
    if (!token || typeof token !== 'string') {
        return { valid: false, error: 'El Token es requerido' };
    }
    if (token.length < 5) {
        return { valid: false, error: 'El Token parece ser demasiado corto' };
    }
    return { valid: true };
};

/**
 * Valida si la URL del webhook es HTTPS válida
 */
export const validateWebhookUrl = (url) => {
    if (!url || typeof url !== 'string') {
        return { valid: false, error: 'La URL del webhook es requerida' };
    }

    try {
        const urlObj = new URL(url);

        if (urlObj.protocol !== 'https:') {
            return { valid: false, error: 'La URL debe usar protocolo HTTPS' };
        }

        return { valid: true };
    } catch (error) {
        return { valid: false, error: 'La URL no es válida' };
    }
};

/**
 * Valida número de teléfono (formato básico)
 */
export const validatePhoneNumber = (number) => {
    if (!number || typeof number !== 'string') {
        return { valid: false, error: 'El número de teléfono es requerido' };
    }

    // Remover espacios y caracteres especiales
    const cleaned = number.replace(/[\s\-\(\)]/g, '');

    // Debe contener solo dígitos y opcionalmente un + al inicio
    const phoneRegex = /^\+?\d{10,15}$/;

    if (!phoneRegex.test(cleaned)) {
        return { valid: false, error: 'Número de teléfono inválido (debe tener 10-15 dígitos)' };
    }

    return { valid: true, cleaned };
};
