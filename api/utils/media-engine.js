/**
 * 📦 MEDIA ENGINE (Transaction-Level Delivery)
 * Specializes in sequenced and reliable media delivery (Stickers, PDFs, Images).
 */
import { sendUltraMsgMessage } from '../whatsapp/utils.js';
import { getRedisClient } from './storage.js';

export class MediaEngine {
    /**
     * Sends a "Congratulations" pack (Sticker + Optional Text)
     */
    static async sendCongratsPack(config, phone, customStickerKey = 'bot_step_move_sticker') {
        const client = getRedisClient();
        const stickerUrl = await client?.get(customStickerKey);

        if (stickerUrl) {
            console.log(`[MEDIA ENGINE] 🚀 Sending Congrats Sticker: ${customStickerKey}`);
            // Fast sequenced delivery
            return await sendUltraMsgMessage(config.instanceId, config.token, phone, stickerUrl, 'sticker');
        }
        return false;
    }

    /**
     * Sends a generic media item with pre-flight check
     */
    static async sendMedia(config, phone, mediaUrl, caption = "") {
        if (!mediaUrl) return false;

        console.log(`[MEDIA ENGINE] 📦 Sending Media: ${mediaUrl}`);

        // Determine type from extension or URL patterns
        let type = 'image';
        if (mediaUrl.toLowerCase().endsWith('.pdf')) type = 'document';
        if (mediaUrl.toLowerCase().includes('sticker')) type = 'sticker';

        return await sendUltraMsgMessage(config.instanceId, config.token, phone, mediaUrl, type, caption);
    }

    /**
     * Resolves the correct bridge sticker based on the transition
     */
    static async resolveBridgeSticker(transitionType) {
        const client = getRedisClient();
        const keys = {
            'EXIT': ['bot_bridge_exit', 'bot_bridge_no_interesa'],
            'STEP_MOVE': ['bot_step_move_sticker', 'bot_bridge_standard'],
            'BIENVENIDA': ['bot_welcome_sticker']
        };

        const searchKeys = keys[transitionType] || [transitionType];
        for (const key of searchKeys) {
            if (await client?.exists(key)) return key;
        }
        return null;
    }
}
