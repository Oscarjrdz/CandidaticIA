import { sendMetaMessage } from '../whatsapp/utils.js';

/**
 * 🚀 SMART MESSENGER v3 — Meta Cloud API
 *
 * Simplified: Single number, no instance routing, no tattoo system.
 * All messages go through Meta's official Graph API.
 */
export const sendMessage = async (number, message, type = 'chat', extraParams = {}) => {
    try {
        // Normalize phone
        const phone = String(number).replace(/[^\d@.]/g, '');

        const result = await sendMetaMessage(phone, message, type, extraParams);

        if (!result.success) {
            return { success: false, error: result.error || 'Meta API Send Error' };
        }

        return {
            success: true,
            data: result.data,
            messageId: result.messageId,
            via: 'meta_cloud_api'
        };

    } catch (error) {
        console.error('❌ Error sending message:', error.message);
        return { success: false, error: error.message };
    }
};

