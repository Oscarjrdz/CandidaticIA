import { getMessages, getCandidates } from '../utils/storage.js';

export default async function handler(req, res) {
    // Basic protection: only allows GET with a secret key if needed, 
    // but for now we'll just check if it's a GET
    if (req.method !== 'GET') return res.status(405).send('Not allowed');

    try {
        const { candidates } = await getCandidates(10);
        const report = [];

        for (const cand of candidates) {
            const messages = await getMessages(cand.id);
            report.push({
                candidate: { nombre: cand.nombre, whatsapp: cand.whatsapp, id: cand.id },
                messageCount: messages.length,
                lastMessages: messages.slice(-5).map(m => ({
                    type: m.type,
                    from: m.from,
                    status: m.status,
                    content: m.content?.substring(0, 50),
                    hasMedia: !!m.mediaUrl,
                    mediaPreview: m.mediaUrl?.substring(0, 30),
                    ultraMsgId: m.ultraMsgId,
                    error: m.error
                }))
            });
        }

        return res.status(200).json(report);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
}
