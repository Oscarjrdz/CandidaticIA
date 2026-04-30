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

        if (!stickerUrl) return false;

        console.log(`[MEDIA ENGINE] 🚀 Sending Congrats Sticker: ${customStickerKey} (mediaId: ${metaMediaId || 'none'})`);

        // Save sticker message to chat history (with correct type for UI display)
        if (candidateId) {
            import('./storage.js').then(async ({ saveMessage }) => {
                await saveMessage(candidateId, { from: 'bot', content: '[Sticker]', type: 'sticker', mediaUrl: stickerUrl, timestamp: new Date().toISOString() }).catch(() => {});
            });
        }

        // Attempt 1: Send with stored mediaId
        if (metaMediaId) {
            const result = await sendMetaMessage(phone, stickerUrl, 'sticker', { mediaId: metaMediaId });
            if (result?.success) return result;
            console.warn(`[MEDIA ENGINE] ⚠️ Stored mediaId expired for ${customStickerKey}, re-uploading...`);
        }

        // Attempt 2: Re-upload from Redis buffer (sticker was saved as base64)
        const imageId = stickerUrl?.split('id=')?.[1];
        if (imageId) {
            const base64 = await client?.get(`image:${imageId}`);
            if (base64) {
                try {
                    const { uploadMediaToMeta } = await import('../whatsapp/utils.js');
                    const buffer = Buffer.from(base64, 'base64');
                    const upload = await uploadMediaToMeta(buffer, 'image/webp', 'sticker.webp');
                    if (upload?.mediaId) {
                        // Update stored mediaId for future sends
                        await client?.set(customStickerKey, JSON.stringify({ url: stickerUrl, mediaId: upload.mediaId }));
                        const result = await sendMetaMessage(phone, stickerUrl, 'sticker', { mediaId: upload.mediaId });
                        if (result?.success) return result;

                        // If sticker format rejected, try as image
                        console.warn(`[MEDIA ENGINE] ⚠️ Sticker format rejected, falling back to image`);
                        return await sendMetaMessage(phone, stickerUrl, 'image', { mediaId: upload.mediaId });
                    }
                } catch (e) {
                    console.error(`[MEDIA ENGINE] ❌ Re-upload failed:`, e.message);
                }
            }
        }

        // Attempt 3: Last resort — try link-based send (only works if URL is publicly accessible)
        if (stickerUrl?.startsWith('http')) {
            return await sendMetaMessage(phone, stickerUrl, 'image');
        }

        console.error(`[MEDIA ENGINE] ❌ All sticker delivery methods failed for ${customStickerKey}`);
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
