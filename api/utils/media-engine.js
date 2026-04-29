/**
 * 📦 MEDIA ENGINE (Transaction-Level Delivery)
 * Specializes in sequenced and reliable media delivery (Stickers, PDFs, Images).
 * Adapted for Meta Cloud API.
 */
import { sendMetaMessage } from '../whatsapp/utils.js';
import { getRedisClient } from './storage.js';

export class MediaEngine {
    /**
     * Sends a "Congratulations" pack (Sticker + Optional Text)
     */
    static async sendCongratsPack(_config, phone, customStickerKey = 'bot_step_move_sticker', candidateId = null) {
        const client = getRedisClient();
        const rawData = await client?.get(customStickerKey);

        let stickerUrl = rawData;
        let metaMediaId = null;

        if (rawData?.startsWith('{')) {
            try {
                const parsed = JSON.parse(rawData);
                stickerUrl = parsed.url || rawData;
                metaMediaId = parsed.mediaId || null;
            } catch (e) {}
        }

        if (stickerUrl) {
            console.log(`[MEDIA ENGINE] 🚀 Sending Congrats Sticker: ${customStickerKey}`);
            if (candidateId) {
                import('./storage.js').then(async ({ saveMessage }) => {
                    await saveMessage(candidateId, { from: 'bot', content: `[Sticker: ${stickerUrl}]`, timestamp: new Date().toISOString() }).catch(() => {});
                });
            }
            // 🛡️ Try sticker first — if Meta rejects (non-WebP, too large), fall back to image
            const result = await sendMetaMessage(phone, stickerUrl, 'sticker', { mediaId: metaMediaId });
            if (result && result.success) return result;

            // Fallback: send as regular image (works with any format)
            console.warn(`[MEDIA ENGINE] ⚠️ Sticker rejected by Meta, falling back to image for: ${customStickerKey}`);
            return await sendMetaMessage(phone, stickerUrl, 'image', { mediaId: metaMediaId });
        }
        return false;
    }

    /**
     * Sends a generic media item with pre-flight check
     */
    static async sendMedia(_config, phone, mediaUrl, caption = "") {
        if (!mediaUrl) return false;

        console.log(`[MEDIA ENGINE] 📦 Sending Media: ${mediaUrl}`);

        // Determine type from extension or URL patterns
        let type = 'image';
        if (mediaUrl.toLowerCase().endsWith('.pdf')) type = 'document';
        if (mediaUrl.toLowerCase().includes('sticker')) type = 'sticker';

        return await sendMetaMessage(phone, mediaUrl, type, { caption });
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
