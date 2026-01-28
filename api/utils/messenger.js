import { getUltraMsgConfig, sendUltraMsgMessage } from '../whatsapp/utils.js';

/**
 * Helper to send system messages (Auth, PINs, Notifications) via UltraMsg
 */
export const sendMessage = async (number, message) => {
    try {
        const config = await getUltraMsgConfig();

        if (!config || !config.instanceId || !config.token) {
            console.error('❌ Missing UltraMsg Configuration (Checked Env & Redis)');
            return { success: false, error: 'Configuration missing: ULTRAMSG_INSTANCE_ID or TOKEN' };
        }

        console.log(`📤 Sending System Message via UltraMsg to ${number}...`);

        const result = await sendUltraMsgMessage(config.instanceId, config.token, number, message);

        if (!result.success) {
            return {
                success: false,
                error: result.error || 'UltraMsg Send Error'
            };
        }

        return {
            success: true,
            data: result.data,
        };
    } catch (error) {
        console.error('❌ Error sending system message via UltraMsg:', error.message);
        return {
            success: false,
            error: error.message,
        };
    }
};
