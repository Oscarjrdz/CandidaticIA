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
                    candidatesReady.push(candidate);
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

        const listRes = await fetch(builderBotUrl, {
            headers: { 'x-api-builderbot': credentials.apiKey }
        });

        if (!listRes.ok) {
            throw new Error(`Failed to list files: ${listRes.status}`);
        }

        const files = await listRes.json();

        if (Array.isArray(files)) {
            existingFile = files.find(f => f.filename && f.filename.startsWith(prefix));

            if (existingFile) {
                console.log(`📌 Found existing file: ${existingFile.filename} (ID: ${existingFile.id})`);

                // STEP 3: Delete old file (Direct Call)
                console.log(`🗑️ Deleting old file...`);
                // Note: DELETE URL requires fileId as query param
                const deleteUrl = `${builderBotUrl}?fileId=${existingFile.id}`;

                const deleteRes = await fetch(deleteUrl, {
                    method: 'DELETE',
                    headers: { 'x-api-builderbot': credentials.apiKey }
                });

                if (!deleteRes.ok) {
                    const errorText = await deleteRes.text();
                    throw new Error(`Failed to delete old file: ${errorText}`);
                }

                deletedSuccessfully = true;
                console.log(`✅ Old file deleted successfully`);
            } else {
                console.log(`ℹ️ No existing file found, uploading new one`);
            }
        }

        // STEP 4: Upload new file (Direct Call)
        console.log(`📤 Uploading new file for ${candidate.whatsapp}...`);

        const FormData = (await import('form-data')).default;
        const formData = new FormData();

        formData.append('file', Buffer.from(chatContent, 'utf-8'), {
            filename: filename,
            contentType: 'text/plain'
        });

        const uploadRes = await fetch(builderBotUrl, {
            method: 'POST',
            body: formData,
            headers: {
                ...formData.getHeaders(),
                'x-api-builderbot': credentials.apiKey
            }
        });

        if (!uploadRes.ok) {
            const errorText = await uploadRes.text();
            throw new Error(`Upload failed: ${errorText}`);
        }

        const uploadResult = await uploadRes.json();
        console.log(`✅ File uploaded successfully for ${candidate.whatsapp}`);

        return {
            success: true,
            replaced: deletedSuccessfully,
            fileId: uploadResult.id || uploadResult.fileId
        };

    } catch (error) {
        console.error(`❌ Error in exportAndUpload for ${candidate.whatsapp}:`, error.message);

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
function generateChatContent(candidate) {
    let content = `=== Chat History for ${candidate.nombre || candidate.whatsapp} ===\n`;
    content += `WhatsApp: ${candidate.whatsapp}\n`;
    content += `Exported: ${new Date().toISOString()}\n`;
    content += `\n${'='.repeat(50)}\n\n`;

    if (!candidate.messages || candidate.messages.length === 0) {
        content += 'No messages found.\n';
        return content;
    }

    // Sort messages by timestamp
    const sortedMessages = [...candidate.messages].sort((a, b) =>
        new Date(a.timestamp) - new Date(b.timestamp)
    );

    for (const msg of sortedMessages) {
        const timestamp = new Date(msg.timestamp).toLocaleString('es-MX');
        const sender = msg.from === candidate.whatsapp ? candidate.nombre || 'Candidato' : 'Bot';
        content += `[${timestamp}] ${sender}:\n${msg.body}\n\n`;
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
 * Get BuilderBot credentials from Redis (same as frontend Settings)
 */
async function getBuilderBotCredentials() {
    if (!process.env.REDIS_URL) return null;

    try {
        const { getRedisClient } = await import('../utils/storage.js');
        const redis = getRedisClient();
        const value = await redis.get('builderbot_credentials');
        return value ? JSON.parse(value) : null;
    } catch (error) {
        console.warn('Error getting BuilderBot credentials:', error);
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
