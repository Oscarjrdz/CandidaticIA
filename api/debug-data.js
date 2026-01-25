
import { getCandidates, getMessages, getClient } from './utils/storage.js';

export default async function handler(req, res) {
    try {
        const client = getClient();
        if (!client) return res.status(500).json({ error: 'No Redis' });

        // Get all candidates
        const { candidates } = await getCandidates(200);

        const summary = [];

        for (const c of candidates) {
            const msgs = await getMessages(c.id);
            summary.push({
                id: c.id,
                name: c.nombre,
                phone: c.whatsapp,
                messageCount: msgs.length,
                lastMsg: msgs.length > 0 ? msgs[msgs.length - 1] : null,
                raw_phone_cleaned: c.whatsapp ? c.whatsapp.replace(/\D/g, '') : 'N/A'
            });
        }

        // Sort by message count desc to find active ones
        summary.sort((a, b) => b.messageCount - a.messageCount);

        return res.status(200).json({
            count: summary.length,
            candidates: summary
        });

    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
