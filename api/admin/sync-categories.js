/**
 * Manual Categories Sync Script
 * GET /api/admin/sync-categories?key=oscar_debug_2026
 */
export default async function handler(req, res) {
    const { key } = req.query;
    if (key !== 'oscar_debug_2026') return res.status(401).json({ error: 'Unauthorized' });

    try {
        const { syncCategoriesToBuilderBot } = await import('../utils/assistant-sync.js');
        await syncCategoriesToBuilderBot();

        return res.status(200).json({
            success: true,
            message: 'Sincronización de categorías iniciada / completada (ver logs)'
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
