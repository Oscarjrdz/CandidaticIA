/**
 * Vacancies API - Manage job vacancies
 * GET /api/vacancies - List all vacancies
 * POST /api/vacancies - Create a new vacancy
 * PUT /api/vacancies - Update a vacancy
 * DELETE /api/vacancies - Delete a vacancy
 */

import { randomUUID } from 'crypto';

const BUILDERBOT_API_URL = 'https://app.builderbot.cloud/api/v2';

/**
 * Sync vacancies list to BuilderBot Knowledge Base
 */
const syncVacanciesToBuilderBot = async (redis, vacancies) => {
    try {
        console.log('🔄 Syncing vacancies to BuilderBot...');

        // 1. Get Credentials
        const credsJson = await redis.get('builderbot_credentials');
        if (!credsJson) {
            console.warn('⚠️ No credentials found in Redis. Skipping sync.');
            return;
        }
        const { botId, apiKey, answerId } = JSON.parse(credsJson);

        if (!botId || !apiKey || !answerId) {
            console.warn('⚠️ Incomplete credentials (botId, apiKey, answerId required). Skipping sync.');
            return;
        }

        // 2. Generate Content
        let content = "LISTA DE VACANTES DISPONIBLES\n===============================\n\n";
        if (vacancies.length === 0) {
            content += "No hay vacantes disponibles actualmente.";
        } else {
            vacancies.forEach((v, i) => {
                if (v.active) {
                    content += `VACANTE #${i + 1}\n`;
                    content += `Nombre: ${v.name}\n`;
                    content += `Empresa: ${v.company}\n`;
                    content += `Categoría: ${v.category}\n`;
                    content += `Descripción: ${v.description}\n`;
                    content += `-------------------------------\n`;
                }
            });
        }

        // 3. Robust Cleanup: List and delete ALL old 'vacantes' files
        // This prevents duplicates even if Redis ID was lost
        await cleanupOldFiles(botId, apiKey, answerId);

        // 4. Upload New File
        const newFileId = await uploadFileToBuilderBot(botId, apiKey, answerId, content);

        // 5. Save New ID (Still useful for reference)
        if (newFileId) {
            await redis.set('vacancies_file_id', newFileId);
            console.log('✅ Vacancies synced successfully. New File ID:', newFileId);
        }

    } catch (error) {
        console.error('❌ Error syncing vacancies:', error);
        // Don't throw, just log. We don't want to break the API response.
    }
};

/**
 * Helper: List and delete old 'vacantes' files
 * Returns debug info object
 */
const cleanupOldFiles = async (botId, apiKey, answerId) => {
    console.log('🧹 Cleaning up old vacancies files...');
    const result = {
        found: 0,
        deleted: 0,
        errors: [],
        filesFound: []
    };

    try {
        // MATCH export-chats.js: Add ?type=files
        const listRes = await fetch(`${BUILDERBOT_API_URL}/${botId}/answer/${answerId}/plugin/assistant/files?type=files`, {
            method: 'GET',
            headers: { 'x-api-builderbot': apiKey }
        });

        if (listRes.ok) {
            const rawData = await listRes.json();
            // Handle various response structrues
            let files = [];
            if (Array.isArray(rawData)) files = rawData;
            else if (rawData && Array.isArray(rawData.files)) files = rawData.files;
            else if (rawData && Array.isArray(rawData.data)) files = rawData.data;

            result.found = files.length;

            // Filter: Check 'filename' OR 'name'
            const duplicates = files.filter(f => {
                const name = f.filename || f.name || '';
                // Strict check: must start with vacantes
                return name === 'vacantes.txt' || name.startsWith('vacantes');
            });

            result.filesFound = duplicates.map(f => f.filename || f.name);
            console.log(`Found ${duplicates.length} old files to delete.`);

            for (const file of duplicates) {
                try {
                    const fileId = file.id || file.file_id;
                    if (fileId) {
                        await deleteFileFromBuilderBot(botId, apiKey, answerId, fileId);
                        result.deleted++;
                    }
                } catch (delErr) {
                    console.warn('Error deleting specific file:', delErr);
                    result.errors.push(delErr.message);
                }
            }
        } else {
            result.errors.push(`List failed: ${listRes.status}`);
        }
    } catch (listErr) {
        console.error('Failed to list files for cleanup:', listErr);
        result.errors.push(listErr.message);
    }
    return result;
};

const deleteFileFromBuilderBot = async (botId, apiKey, answerId, fileId) => {
    try {
        console.log(`🗑️ Deleting file ${fileId} via Query Param...`);
        // Reverted to Query Param style as per export-chats.js pattern which works
        const res = await fetch(`${BUILDERBOT_API_URL}/${botId}/answer/${answerId}/plugin/assistant/files?fileId=${fileId}`, {
            method: 'DELETE',
            headers: { 'x-api-builderbot': apiKey }
        });

        if (!res.ok) {
            console.warn(`⚠️ Delete failed for ${fileId}: ${res.status} ${res.statusText}`);
            // Try Path param as fallback just in case? No, sticking to one proven way is better.
        } else {
            console.log(`✅ Deleted ${fileId}`);
        }
    } catch (e) {
        console.warn('Failed to delete old file:', e.message);
    }
};

const uploadFileToBuilderBot = async (botId, apiKey, answerId, content) => {
    try {
        const formData = new FormData();
        const blob = new Blob([content], { type: 'text/plain' });
        // Ensure just 'vacantes.txt' is requested, BuilderBot adds timestamp
        formData.append('file', blob, 'vacantes.txt');

        const res = await fetch(`${BUILDERBOT_API_URL}/${botId}/answer/${answerId}/plugin/assistant/files`, {
            method: 'POST',
            headers: { 'x-api-builderbot': apiKey },
            body: formData
        });

        const data = await res.json();
        return data.id || data.file_id;
    } catch (e) {
        console.error('Failed to upload file:', e);
        return null;
    }
};

export { cleanupOldFiles }; // Export for internal use if needed, though handler uses it directly

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        // DYNAMIC IMPORT: Load storage safely
        const { getRedisClient } = await import('./utils/storage.js');
        const redis = getRedisClient();

        // En memoria local (storage.js) getRedisClient retorna null,
        // así que debemos manejar ese caso si estamos en modo "sin redis".
        // Sin embargo, si storage.js está en modo memoria, getRedisClient retorna null
        // y este endpoint falla con "redis.get is not a function" o similar.
        // Adaptaremos para usar memoria si redis es null?
        // NO, este endpoint está diseñado alrededor de Redis por su uso de 'getKey', etc.
        // PERO, si estamos en modo memoria, quizás deberíamos simular?
        // Por ahora, asumimos que si getRedisClient retorna null es un problema de config o modo memoria.
        // Si es null, retornamos lista vacía para no romper el frontend.

        if (!redis) {
            console.warn('⚠️ Vacancies API: Redis client is null (Memory Mode?). 返回空列表.');
            // Si el método es GET, retornamos vacío. Si es POST/PUT, error 501 Not Implemented?
            // Para mejor UX, permitamos que el frontend cargue vacío en vez de error.
            if (req.method === 'GET') {
                return res.status(200).json({ success: true, data: [] });
            }
            return res.status(503).json({
                error: 'Service Unavailable',
                message: 'Storage service not available (Redis missing)'
            });
        }

        const KEY = 'candidatic_vacancies';

        // GET - List vacancies
        if (req.method === 'GET') {
            const data = await redis.get(KEY);
            const vacancies = data ? JSON.parse(data) : [];
            return res.status(200).json({
                success: true,
                data: vacancies
            });
        }

        // POST - Create vacancy
        if (req.method === 'POST') {
            const body = req.body;
            const { name, company, category, description } = body;

            if (!name || !company || !category) {
                return res.status(400).json({ error: 'Missing required fields (name, company, category)' });
            }

            const newVacancy = {
                id: randomUUID(),
                name,
                company,
                category,
                description: description || '',
                createdAt: new Date().toISOString(),
                active: true
            };

            const data = await redis.get(KEY);
            const vacancies = data ? JSON.parse(data) : [];

            vacancies.unshift(newVacancy);

            await redis.set(KEY, JSON.stringify(vacancies));

            // TRIGGER SYNC
            await syncVacanciesToBuilderBot(redis, vacancies);

            return res.status(201).json({
                success: true,
                data: newVacancy
            });
        }

        // PUT - Update vacancy
        if (req.method === 'PUT') {
            const body = req.body;
            const { id, ...updates } = body;

            if (!id) return res.status(400).json({ error: 'Missing id' });

            const data = await redis.get(KEY);
            let vacancies = data ? JSON.parse(data) : [];

            const index = vacancies.findIndex(v => v.id === id);
            if (index === -1) return res.status(404).json({ error: 'Vacancy not found' });

            vacancies[index] = { ...vacancies[index], ...updates };

            await redis.set(KEY, JSON.stringify(vacancies));

            // TRIGGER SYNC
            await syncVacanciesToBuilderBot(redis, vacancies);

            return res.status(200).json({ success: true, data: vacancies[index] });
        }

        // DELETE - Remove vacancy OR Purge All Files
        if (req.method === 'DELETE') {
            const { id, purge } = req.query;

            // Manual Purge Action
            if (purge === 'true') {
                try {
                    const credsJson = await redis.get('builderbot_credentials');
                    if (!credsJson) throw new Error('No credentials');
                    const { botId, apiKey, answerId } = JSON.parse(credsJson);

                    // Run the cleanup logic directly
                    const debug = await cleanupOldFiles(botId, apiKey, answerId);

                    return res.status(200).json({
                        success: true,
                        message: `Purge Complete. Found: ${debug.found}, Matches: ${debug.filesFound.length}, Deleted: ${debug.deleted}`,
                        debug: debug
                    });
                } catch (err) {
                    return res.status(500).json({ error: 'Purge failed', details: err.message });
                }
            }

            if (!id) return res.status(400).json({ error: 'Missing id query parameter' });

            const data = await redis.get(KEY);
            let vacancies = data ? JSON.parse(data) : [];

            const newVacancies = vacancies.filter(v => v.id !== id);

            await redis.set(KEY, JSON.stringify(newVacancies));

            // TRIGGER SYNC
            await syncVacanciesToBuilderBot(redis, newVacancies);

            return res.status(200).json({ success: true });
        }

        return res.status(405).json({ error: 'Method not allowed' });

    } catch (error) {
        console.error('Vacancies API Error:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
}

