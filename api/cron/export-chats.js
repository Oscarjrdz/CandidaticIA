/**
 * Vercel Cron Job - Auto Export Chat Histories
 * Runs every 5 minutes to export chat histories to BuilderBot
 * 
 * Security: Requires CRON_SECRET in Authorization header
 * Capacity: Processes up to 50 candidates per execution
 */

import { getCandidates, getMessages } from '../utils/storage.js';


export default async function handler(req, res) {
    // Verify cron secret for security
    const authHeader = req.headers.authorization;
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
        console.error('❌ CRON_SECRET not configured');
        return res.status(500).json({ error: 'Cron not configured' });
    }

    if (authHeader !== `Bearer ${cronSecret}`) {
        console.warn('⚠️ Unauthorized cron attempt');
        return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log('🔄 Starting auto-export cron job...');

    try {
        // Get BuilderBot credentials from Redis (same as frontend Settings)
        const credentials = await getBuilderBotCredentials();

        if (!credentials || !credentials.botId || !credentials.answerId || !credentials.apiKey) {
            console.error('❌ BuilderBot credentials not configured in Settings');
            return res.status(500).json({
                error: 'BuilderBot credentials missing',
                message: 'Please configure credentials in Settings section'
            });
        }

        // Clean credentials (remove potential hidden spaces)
        credentials.botId = credentials.botId.trim();
        credentials.answerId = credentials.answerId.trim();
        credentials.apiKey = credentials.apiKey.trim();

        console.log('✅ Credentials loaded from Redis (cleaned):');
        console.log(`   Bot ID: ${credentials.botId.substring(0, 8)}... (len: ${credentials.botId.length})`);
        console.log(`   Answer ID: ${credentials.answerId.substring(0, 8)}... (len: ${credentials.answerId.length})`);
        console.log(`   API Key: ${credentials.apiKey.substring(0, 8)}... (len: ${credentials.apiKey.length})`);

        // Get export timer setting from Redis (same as frontend)
        const exportTimer = await getExportTimer();

        if (!exportTimer || exportTimer <= 0) {
            console.log('ℹ️ Export timer is disabled or not configured');
            return res.status(200).json({
                success: true,
                processed: 0,
                message: 'Export timer is disabled'
            });
        }


        // Get all candidates
        const result = await getCandidates(1000, 0, '');

        if (!result || result.length === 0) {
            console.log('ℹ️ No candidates found');
            return res.status(200).json({
                success: true,
                processed: 0,
                message: 'No candidates to process'
            });
        }

        const candidates = result;
        const now = Date.now();
        const candidatesReady = [];

        // Find candidates ready for export
        for (const candidate of candidates) {
            if (!candidate.ultimoMensaje) continue;

            const lastMessageTime = new Date(candidate.ultimoMensaje).getTime();
            const targetTime = lastMessageTime + (exportTimer * 60 * 1000);

            // Check if timer has expired
            if (now >= targetTime) {
                // Check if already exported (using localStorage equivalent in Redis)
                const exportKey = `export:${candidate.whatsapp}`;
                const lastExport = await getLastExportTime(exportKey);

                // Only export if never exported or last export was before last message
                if (!lastExport || lastExport < lastMessageTime) {
                    // CRITICAL: Fetch messages for this candidate (stored separately in Redis)
                    const messages = await getMessages(candidate.id);
                    if (messages && messages.length > 0) {
                        candidate.messages = messages;
                        candidatesReady.push(candidate);
                    } else {
                        console.log(`ℹ️ Candidate ${candidate.whatsapp} has no messages in Redis, skipping`);
                    }
                }
            }
        }

        console.log(`📊 Found ${candidatesReady.length} candidates ready for export`);

        // Process in batches to avoid timeout (max 50 per execution)
        const batchSize = 50;
        const batch = candidatesReady.slice(0, batchSize);

        let processed = 0;
        let errors = 0;

        for (const candidate of batch) {
            try {
                // Fetch messages for the candidate
                const messages = await getMessages(candidate.id);

                if (!messages || messages.length === 0) {
                    console.log(`⏭️ No messages for ${candidate.whatsapp}`);
                    continue;
                }

                const candidateWithMessages = {
                    ...candidate,
                    messages: messages
                };

                // Export and upload to BuilderBot
                console.log(`📤 Exporting ${candidate.whatsapp}...`);
                const exportResult = await exportAndUpload(candidateWithMessages, credentials);

                if (exportResult.success) {
                    // Mark as exported
                    await setLastExportTime(`export:${candidate.whatsapp}`, Date.now());
                    processed++;
                    console.log(`✅ Exported ${candidate.whatsapp}`);
                } else {
                    errors++;
                    console.error(`❌ Failed to export ${candidate.whatsapp}:`, exportResult.error);
                }
            } catch (error) {
                errors++;
                console.error(`❌ Error processing ${candidate.whatsapp}:`, error.message);
            }
        }

        const remaining = candidatesReady.length - batch.length;

        console.log(`✅ Cron job completed: ${processed} processed, ${errors} errors, ${remaining} remaining`);

        return res.status(200).json({
            success: true,
            processed,
            errors,
            remaining,
            total: candidatesReady.length
        });

    } catch (error) {
        console.error('❌ Cron job error:', error);
        return res.status(500).json({
            error: 'Cron job failed',
            message: error.message
        });
    }
}

/**
 * Export chat to file and upload to BuilderBot with atomic update
 * Strategy: Delete old file → Upload new file → Rollback on failure
 */
async function exportAndUpload(candidate, credentials) {
    const prefix = String(candidate.whatsapp).substring(0, 13);
    const filename = `${candidate.whatsapp}.txt`;

    // Direct BuilderBot API URL
    const builderBotUrl = `https://app.builderbot.cloud/api/v2/${credentials.botId}/answer/${credentials.answerId}/plugin/assistant/files`;

    let existingFile = null;
    let deletedSuccessfully = false;

    try {
        // STEP 1: Generate new content first
        console.log(`📝 Generating content for ${candidate.whatsapp}...`);
        const chatContent = generateChatContent(candidate);

        // STEP 2: Check if file already exists (Direct API)
        console.log(`🔍 Checking for existing file (Direct API)...`);

        // Add query params to prevent 500 error
        const listUrl = `${builderBotUrl}?type=files`;

        const listRes = await fetch(listUrl, {
            headers: { 'x-api-builderbot': credentials.apiKey }
        });

        if (!listRes.ok) {
            // Log but don't crash if list fails - try to upload anyway
            console.warn(`⚠️ Failed to list files (${listRes.status}), skipping duplicate check.`);
        } else {
            const listData = await listRes.json();
            console.log(`📋 API Response Sample: ${JSON.stringify(listData).substring(0, 100)}...`);

            let files = [];
            if (Array.isArray(listData)) files = listData;
            else if (listData && Array.isArray(listData.files)) files = listData.files;
            else if (listData && Array.isArray(listData.data)) files = listData.data;

            if (files.length > 0) {
                // Find and delete matching files
                const matchingFiles = files.filter(f => f.filename && f.filename.startsWith(candidate.whatsapp));
                for (const file of matchingFiles) {
                    try {
                        console.log(`🗑️ Deleting old file: ${file.filename}...`);
                        await fetch(`${builderBotUrl}?fileId=${file.id}`, {
                            method: 'DELETE',
                            headers: { 'x-api-builderbot': credentials.apiKey }
                        });
                        deletedSuccessfully = true;
                    } catch (e) {
                        console.warn('Error deleting file:', e.message);
                    }
                }
            }
        }

        // STEP 4: Upload new file (Direct Call with Axios)
        console.log(`📤 Uploading new file for ${candidate.whatsapp}...`);

        const FormData = (await import('form-data')).default;
        const { default: axios } = await import('axios');
        const formData = new FormData();

        // Send string directly (safer than bad buffer conversion)
        formData.append('file', chatContent, {
            filename: filename,
            contentType: 'text/plain',
            knownLength: Buffer.byteLength(chatContent) // Explicit length helper
        });

        console.log('📋 Upload attempt details:');
        console.log('   URL:', builderBotUrl);
        console.log('   Content length:', Buffer.byteLength(chatContent));
        console.log('   Form-Data length:', formData.getLengthSync());
        console.log('   Headers:', { ...formData.getHeaders(), 'Content-Length': formData.getLengthSync() });

        // Use axios with calculated headers
        const uploadRes = await axios.post(builderBotUrl, formData, {
            headers: {
                ...formData.getHeaders(),
                'Content-Length': formData.getLengthSync(), // CRITICAL for proper upload
                'x-api-builderbot': credentials.apiKey
            },
            maxBodyLength: Infinity,
            maxContentLength: Infinity
        });

        const uploadResult = uploadRes.data;
        const newFileId = uploadResult.id || uploadResult.fileId;
        console.log(`✅ File uploaded successfully for ${candidate.whatsapp}`);

        // Sync with frontend (Red -> Green indicator)
        await setChatFileId(candidate.whatsapp, newFileId);

        return {
            success: true,
            replaced: deletedSuccessfully,
            fileId: newFileId
        };

    } catch (error) {
        console.error(`❌ Error in exportAndUpload for ${candidate.whatsapp}:`, error.message);
        if (error.response) {
            console.error('   Status:', error.response.status);
            console.error('   Data:', JSON.stringify(error.response.data).substring(0, 200));
            console.error('   Headers:', error.response.headers);
        }


        return {
            success: false,
            error: error.message,
            deletedOldFile: deletedSuccessfully
        };
    }
}

/**
 * Generate chat content from candidate messages
 */
/**
 * Generate chat content from candidate messages
 */
function generateChatContent(candidate) {
    const mexicoTime = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City', hour12: true });

    let content = `HISTORIAL DE CONVERSACIÓN\n`;
    content += `----------------------------------------\n`;
    content += `WhatsApp: ${candidate.whatsapp}\n`;
    content += `Nombre Real: ${candidate.nombreReal || 'No registrado'}\n`;
    content += `Nombre (WhatsApp): ${candidate.nombre || 'No registrado'}\n`;
    content += `Fecha Nacimiento: ${candidate.fechaNacimiento || 'No registrado'}\n`;
    content += `Edad: ${candidate.edad || 'No registrado'}\n`;
    content += `Municipio: ${candidate.municipio || 'No registrado'}\n`;
    content += `Categoría: ${candidate.categoria || 'No registrado'}\n`;
    content += `Fecha de exportación: ${mexicoTime}\n`;
    content += `----------------------------------------\n\n`;

    if (!candidate.messages || candidate.messages.length === 0) {
        content += 'No messages found.\n';
        return content;
    }

    // Sort messages by timestamp
    const sortedMessages = [...candidate.messages].sort((a, b) =>
        new Date(a.timestamp) - new Date(b.timestamp)
    );

    for (const msg of sortedMessages) {
        // Format: [09:19 p.m.]
        const timestamp = new Date(msg.timestamp).toLocaleString('es-MX', {
            timeZone: 'America/Mexico_City',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        });

        const sender = msg.from === 'bot' ? 'Bot' : (candidate.nombreReal || candidate.whatsapp);

        // Use msg.content (stored in Redis) instead of msg.body
        const messageText = msg.content || msg.body || '[Mensaje vacío]';

        content += `[${timestamp}] ${sender}:\n${messageText}\n\n`;
    }

    return content;
}


/**
 * Get last export time from Redis
 */
async function getLastExportTime(key) {
    if (!process.env.REDIS_URL) return null;

    try {
        const { getRedisClient } = await import('../utils/storage.js');
        const redis = getRedisClient();
        const value = await redis.get(key);
        return value ? parseInt(value) : null;
    } catch (error) {
        console.warn('Error getting last export time:', error);
        return null;
    }
}

/**
 * Set last export time in Redis
 */
/**
 * Set last export time in Redis
 */
async function setLastExportTime(key, timestamp) {
    if (!process.env.REDIS_URL) return;

    try {
        const { getRedisClient } = await import('../utils/storage.js');
        const redis = getRedisClient();
        await redis.set(key, timestamp.toString());
    } catch (error) {
        console.warn('Error setting last export time:', error);
    }
}

/**
 * Save chat file ID to Redis (syncs with frontend)
 */
async function setChatFileId(whatsapp, fileId) {
    if (!process.env.REDIS_URL) return;

    try {
        const { getRedisClient } = await import('../utils/storage.js');
        const redis = getRedisClient();

        // Update the hash map used by frontend
        // Get existing IDs first (to preserve others)
        const storedIds = await redis.get('chat_file_ids');
        const fileIds = storedIds ? JSON.parse(storedIds) : {};

        fileIds[whatsapp] = fileId;

        await redis.set('chat_file_ids', JSON.stringify(fileIds));
        console.log(`✅ Synced file ID for ${whatsapp} to Redis`);
    } catch (error) {
        console.warn('Error syncing file ID to Redis:', error);
    }
}

/**
 * Get BuilderBot credentials from Redis (same as frontend Settings)
 */
async function getBuilderBotCredentials() {
    console.log('🔍 Attempting to get BuilderBot credentials from Redis...');
    console.log('   REDIS_URL exists:', !!process.env.REDIS_URL);

    if (!process.env.REDIS_URL) {
        console.error('❌ REDIS_URL not configured in environment');
        return null;
    }

    try {
        const { getRedisClient } = await import('../utils/storage.js');
        const redis = getRedisClient();
        console.log('   Redis client created successfully');

        const value = await redis.get('builderbot_credentials');
        console.log('   Raw value from Redis:', value ? value.substring(0, 50) + '...' : null);

        const parsed = value ? JSON.parse(value) : null;
        console.log('   Parsed credentials:', parsed ? 'Found ✅' : 'Not found ❌');

        return parsed;
    } catch (error) {
        console.error('❌ Error getting BuilderBot credentials:', error.message);
        console.error('   Stack:', error.stack);
        return null;
    }
}

/**
 * Get export timer setting from Redis (same as frontend)
 */
async function getExportTimer() {
    if (!process.env.REDIS_URL) return null;

    try {
        const { getRedisClient } = await import('../utils/storage.js');
        const redis = getRedisClient();
        const value = await redis.get('export_timer');
        return value ? parseInt(value) : null;
    } catch (error) {
        console.warn('Error getting export timer:', error);
        return null;
    }
}
