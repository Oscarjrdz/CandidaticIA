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

        // 3. Get Credentials - Use the same source as vacancies.js
        const credsJson = await redis.get('builderbot_credentials');
        if (!credsJson) {
            console.warn('⚠️ No credentials found in Redis (builderbot_credentials). Skipping category sync.');
            return;
        }

        const { botId, answerId, apiKey } = JSON.parse(credsJson);

        if (!botId || !answerId || !apiKey) {
            console.warn('⚠️ Incomplete credentials in Redis. Skipping category sync.');
            return;
        }

        const baseUrl = `${BUILDERBOT_API_URL}/${botId}/answer/${answerId}/plugin/assistant/files`;

        // 4. Find and Delete existing file
        try {
            // Add ?type=files to match vacancies.js and ensure correct list
            const listRes = await axios.get(`${baseUrl}?type=files`, {
                headers: { 'x-api-builderbot': apiKey }
            });

            const rawData = listRes.data;
            let files = [];
            if (Array.isArray(rawData)) files = rawData;
            else if (rawData && Array.isArray(rawData.files)) files = rawData.files;
            else if (rawData && Array.isArray(rawData.data)) files = rawData.data;

            if (Array.isArray(files)) {
                // Check filename OR name, and use startsWith to handle possible ID suffixes
                const duplicates = files.filter(f => {
                    const name = f.filename || f.name || '';
                    return name === fileName || name.startsWith('categorias');
                });

                for (const file of duplicates) {
                    const fileId = file.id || file.file_id;
                    if (fileId) {
                        console.log(`🗑️ Deleting old categories file: ${file.filename || file.name} (ID: ${fileId})`);
                        await axios.delete(`${baseUrl}?fileId=${fileId}`, {
                            headers: { 'x-api-builderbot': apiKey }
                        });
                    }
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
