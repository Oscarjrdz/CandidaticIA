export default async function handler(req, res) {
    try {
        const { getRedisClient } = await import('./utils/storage.js');
        const redis = getRedisClient();
        
        if (req.method === 'GET') {
            const raw = await redis.get('candidatic:chat_tags');
            let savedTags = raw ? JSON.parse(raw) : [{name: 'Urgente', color: '#64748b'}, {name: 'Entrevista', color: '#f97316'}, {name: 'Contratado', color: '#eab308'}, {name: 'Rechazado', color: '#22c55e'}, {name: 'Duda', color: '#3b82f6'}];
            
            const tags = savedTags.map(t => typeof t === 'string' ? {name: t, color: '#3b82f6'} : t);

            // Calculate active counts!
            const { getCandidates } = await import('./utils/storage.js');
            // Fetch basically all recent candidates to aggregate (10k buffer)
            const { candidates } = await getCandidates(20000, 0, '');

            // Initialize counts
            tags.forEach(t => t.count = 0);

            // Count occurrences
            candidates.forEach(c => {
                if (Array.isArray(c.tags)) {
                    c.tags.forEach(tName => {
                        const tagObj = tags.find(to => to.name === tName);
                        if (tagObj) tagObj.count++;
                    });
                }
            });

            return res.status(200).json({ success: true, tags });
        }
        
        if (req.method === 'POST') {
            const { tags } = req.body;
            await redis.set('candidatic:chat_tags', JSON.stringify(tags));
            return res.status(200).json({ success: true, tags });
        }
        
        if (req.method === 'DELETE') {
            const tagName = req.query.name;
            if (!tagName) return res.status(400).json({ error: 'Falta nombre de etiqueta' });
            
            // 1. Remove from global tags
            const raw = await redis.get('candidatic:chat_tags');
            let savedTags = raw ? JSON.parse(raw) : [];
            const newTags = savedTags.filter(t => (typeof t === 'string' ? t : t.name) !== tagName);
            await redis.set('candidatic:chat_tags', JSON.stringify(newTags));
            
            // 2. Cascading deletion (Remove from all candidates)
            const { getCandidates, saveCandidate } = await import('./utils/storage.js');
            // Fetch a sufficiently large buffer to cover all active candidates
            const { candidates } = await getCandidates(20000, 0, '');
            
            // Update only candidates having the tag
            const promises = [];
            for (let c of candidates) {
                if (c.tags && Array.isArray(c.tags) && c.tags.includes(tagName)) {
                    c.tags = c.tags.filter(t => t !== tagName);
                    promises.push(saveCandidate(c));
                }
            }
            
            if (promises.length > 0) {
                await Promise.all(promises);
            }
            
            return res.status(200).json({ success: true, message: `Etiqueta '${tagName}' eliminada globalmente`, tags: newTags });
        }
        
        return res.status(405).json({ error: 'Method not allowed' });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
