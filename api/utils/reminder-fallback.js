/**
 * reminder-fallback.js
 * Lógica compartida para reintentar un recordatorio directo con su WhatsApp template
 * de respaldo cuando el texto libre no se pudo entregar por ventana de 24h cerrada.
 *
 * Meta puede rechazar esto de dos formas distintas:
 *   1. Síncrona: el POST del mensaje responde con error 131047 al instante — lo maneja
 *      api/cron/send-reminders.js justo después de intentar el texto.
 *   2. Asíncrona: Meta responde 200 OK (acepta el mensaje) y el rechazo real llega
 *      minutos/segundos después por el webhook de status ('failed') — lo maneja
 *      api/whatsapp/webhook.js. Sin esto, un recordatorio con template configurado
 *      igual se quedaba sin plan B cuando el rechazo llegaba async (encontrado en
 *      pruebas reales 2026-08-07: Meta aceptó el texto, lo rechazó por webhook 1s
 *      después, y el fallback nunca se intentó).
 *
 * Ambos casos deben usar exactamente la misma lógica de armar/enviar el template —
 * de ahí este archivo, en vez de tener la lógica duplicada en los dos lados.
 */

import { getUltraMsgConfig, sendUltraMsgMessage, buildMetaTemplateComponents, renderMetaTemplatePreviewText } from '../whatsapp/utils.js';

export const META_24H_WINDOW_ERROR_CODE = 131047;

export function isMeta24hWindowError(result = {}) {
    const error = result.data?.error || {};
    const code = Number(error.code || result.code || 0);
    const text = [
        result.error,
        error.message,
        error.error_data?.details,
        JSON.stringify(result.data || {})
    ].filter(Boolean).join(' ').toLowerCase();

    return code === META_24H_WINDOW_ERROR_CODE ||
        text.includes('131047') ||
        text.includes('24 hour') ||
        text.includes('24-hour') ||
        text.includes('outside the allowed window') ||
        text.includes('re-engagement');
}

export function candidateFirstName(candidate = {}, fallback = 'Candidato') {
    const name = candidate.nombreReal || candidate.nombre || fallback;
    return String(name || fallback).trim().split(/\s+/)[0] || fallback;
}

/**
 * Intenta enviar el template de respaldo de un direct_reminder.
 * @returns {Promise<{attempted:false} | {attempted:true, success:boolean, result:object, contentToSave?:string, messageId?:string}>}
 */
export async function attemptReminderTemplateFallback({ reminder, candidate }) {
    const templateData = reminder.fallbackTemplateData;
    if (!templateData?.name) return { attempted: false };

    const config = await getUltraMsgConfig(candidate?.incomingPhoneNumberId || candidate?.instanceId);
    if (!config?.token || !config?.instanceId) {
        return { attempted: true, success: false, result: { success: false, error: 'No hay configuración de WhatsApp/Meta.' } };
    }

    const fallbackName = candidateFirstName(candidate, reminder.nombre || 'Candidato');
    const templateParams = reminder.fallbackTemplateParams || {};
    const extraParams = {
        templateName: templateData.name,
        languageCode: templateData.language || 'es_MX',
        priority: 1
    };
    const componentsToSend = buildMetaTemplateComponents(
        templateData.components,
        fallbackName,
        { templateParams, parameterFormat: templateData.parameter_format }
    );
    if (componentsToSend.length > 0) {
        extraParams.components = componentsToSend;
    }

    const templateResult = await sendUltraMsgMessage(
        config.instanceId,
        config.token,
        reminder.whatsapp,
        templateData.name,
        'template',
        extraParams
    );

    if (!templateResult?.success) {
        return { attempted: true, success: false, result: templateResult };
    }

    const displayName = templateData.name.replace(/_/g, ' ');
    const renderedBody = renderMetaTemplatePreviewText(templateData, fallbackName, { templateParams });
    const contentToSave = `⚡ Plantilla de recordatorio: *${displayName}*\n\n${renderedBody}`.trim();

    return { attempted: true, success: true, result: templateResult, contentToSave, messageId: templateResult.messageId };
}
