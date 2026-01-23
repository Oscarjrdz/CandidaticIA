import axios from 'axios';
import FormData from 'form-data';

const BUILDERBOT_API_URL = 'https://app.builderbot.cloud/api/v2';

/**
 * Synchronizes categories to BuilderBot Assistant files
 */
export async function syncCategoriesToBuilderBot() {
    try {
        const { getRedisClient } = await import('./storage.js');
        const redis = getRedisClient();
        if (!redis) return;

        // 1. Get Categories
        const catsData = await redis.get('candidatic_categories');
        const categories = catsData ? JSON.parse(catsData) : [];
        if (categories.length === 0) return;

        // 2. Format file content
        const fileContent = categories.map(c => c.name).join('\n');
        const fileName = 'categorias.txt';

        // 3. Get Credentials
        const aiConfigJson = await redis.get('ai_config');
        if (!aiConfigJson) return;
        const { botId, answerId, geminiApiKey: apiKey } = JSON.parse(aiConfigJson);

        if (!botId || !answerId || !apiKey) {
            console.warn('⚠️ Missing AI credentials for category sync');
            return;
        }

        const baseUrl = `${BUILDERBOT_API_URL}/${botId}/answer/${answerId}/plugin/assistant/files`;

        // 4. Find and Delete existing file
        try {
            const listRes = await axios.get(baseUrl, {
                headers: { 'x-api-builderbot': apiKey }
            });
            const files = listRes.data || [];
            if (Array.isArray(files)) {
                const existing = files.find(f => f.filename === fileName);
                if (existing) {
                    console.log(`🗑️ Deleting existing ${fileName} (ID: ${existing.id || existing.file_id})`);
                    await axios.delete(`${baseUrl}?fileId=${existing.id || existing.file_id}`, {
                        headers: { 'x-api-builderbot': apiKey }
                    });
                }
            }
        } catch (err) {
            console.warn('⚠️ Error listing/deleting existing categories file:', err.message);
        }

        // 5. Upload new file
        const form = new FormData();
        form.append('file', Buffer.from(fileContent), {
            filename: fileName,
            contentType: 'text/plain'
        });

        console.log(`📤 Uploading fresh ${fileName} to BuilderBot...`);
        const uploadRes = await axios.post(baseUrl, form, {
            headers: {
                ...form.getHeaders(),
                'x-api-builderbot': apiKey
            },
            validateStatus: () => true
        });

        if (uploadRes.status === 200 || uploadRes.status === 201) {
            console.log(`✅ ${fileName} synced successfully to BuilderBot`);
        } else {
            console.error(`❌ Error syncing categories to BuilderBot: ${uploadRes.status}`, uploadRes.data);
        }

    } catch (error) {
        console.error('❌ syncCategoriesToBuilderBot Error:', error.message);
    }
}
