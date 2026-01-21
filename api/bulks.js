import { getBulks, saveBulk, deleteBulk } from './utils/storage.js';

/**
 * API: Bulk Campaigns Management
 * GET /api/bulks - List all campaigns
 * POST /api/bulks - Create new campaign
 * DELETE /api/bulks?id=XXX - Delete campaign
 */
export default async function handler(req, res) {
    if (req.method === 'GET') {
        try {
            const bulks = await getBulks();
            return res.status(200).json({ success: true, bulks });
        } catch (error) {
            return res.status(500).json({ success: false, error: error.message });
        }
    }

    if (req.method === 'POST' || req.method === 'PUT') {
        try {
            const bulkData = req.body;

            if (!bulkData.name || !bulkData.messages || !bulkData.recipients) {
                return res.status(400).json({
                    success: false,
                    error: 'Nombre, mensajes y destinatarios son requeridos'
                });
            }

            // Validar que messages sea un array
            const messages = Array.isArray(bulkData.messages)
                ? bulkData.messages
                : [bulkData.messages];

            const campaign = {
                ...bulkData, // Conservar ID y otros campos si es PUT
                name: bulkData.name,
                status: bulkData.status || 'pending',
                scheduledAt: bulkData.scheduledAt || new Date().toISOString(),
                delaySeconds: parseInt(bulkData.delaySeconds) || 30,
                messages: messages,
                recipients: bulkData.recipients,
                filters: bulkData.filters || null,
                totalCount: bulkData.recipients.length,
                sentCount: bulkData.sentCount !== undefined ? bulkData.sentCount : 0,
                lastProcessedAt: bulkData.lastProcessedAt || null
            };

            const saved = await saveBulk(campaign);
            return res.status(200).json({ success: true, bulk: saved });
        } catch (error) {
            return res.status(500).json({ success: false, error: error.message });
        }
    }

    if (req.method === 'DELETE') {
        try {
            const { id } = req.query;
            if (!id) return res.status(400).json({ error: 'ID is required' });

            const success = await deleteBulk(id);
            return res.status(200).json({ success });
        } catch (error) {
            return res.status(500).json({ success: false, error: error.message });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
