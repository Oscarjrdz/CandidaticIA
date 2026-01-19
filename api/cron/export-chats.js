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
 * Export chat to file and upload to BuilderBot
 */
async function exportAndUpload(candidate, credentials) {
    try {
        // Check if file already exists in BuilderBot first
        const prefix = String(candidate.whatsapp).substring(0, 13);
        const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';

        const listParams = new URLSearchParams({
            botId: credentials.botId,
            answerId: credentials.answerId,
            apiKey: credentials.apiKey,
            type: 'files'
        });

        const listRes = await fetch(`${baseUrl}/api/assistant?${listParams}`);

        if (listRes.ok) {
            const files = await listRes.json();
            if (Array.isArray(files)) {
                const alreadyExists = files.some(f => f.filename && f.filename.startsWith(prefix));

                if (alreadyExists) {
                    console.log(`⏭️ File already exists in BuilderBot for ${candidate.whatsapp}`);
                    return { success: true, skipped: true };
                }
            }
        }

        // Generate chat content
        const chatContent = generateChatContent(candidate);
        const filename = `${candidate.whatsapp}.txt`;

        // Upload directly to BuilderBot using FormData
        const FormData = (await import('form-data')).default;
        const formData = new FormData();

        // Add file as buffer
        formData.append('file', Buffer.from(chatContent, 'utf-8'), {
            filename: filename,
            contentType: 'text/plain'
        });

        const uploadParams = new URLSearchParams({
            botId: credentials.botId,
            answerId: credentials.answerId,
            apiKey: credentials.apiKey,
            type: 'files'
        });

        const uploadRes = await fetch(`${baseUrl}/api/assistant?${uploadParams}`, {
            method: 'POST',
            body: formData,
            headers: formData.getHeaders()
        });

        if (!uploadRes.ok) {
            const error = await uploadRes.text();
            return { success: false, error: `Upload failed: ${error}` };
        }

        return { success: true };

    } catch (error) {
        return { success: false, error: error.message };
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
