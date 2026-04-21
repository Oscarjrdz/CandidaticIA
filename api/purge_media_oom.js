import { getRedisClient } from './utils/storage.js';

export default async function handler(req, res) {
    try {
        const client = getRedisClient();
        if (!client) return res.status(500).json({ error: 'No redis' });
        
        let cursor = '0';
        let deletedKeys = 0;
        let freedMemoryApprox = 0;
        
        do {
            const [nextCursor, keys] = await client.scan(cursor, 'MATCH', 'image:*', 'COUNT', 100);
            cursor = nextCursor;
            
            if (keys.length > 0) {
                // Delete them
                await client.del(...keys);
                deletedKeys += keys.length;
            }
        } while (cursor !== '0');
        
        cursor = '0';
        do {
            const [nextCursor, keys] = await client.scan(cursor, 'MATCH', 'meta:image:*', 'COUNT', 100);
            cursor = nextCursor;
            
            if (keys.length > 0) {
                await client.del(...keys);
                deletedKeys += keys.length;
            }
        } while (cursor !== '0');

        return res.status(200).json({ success: true, deletedKeys });
    } catch(e) {
        return res.status(500).json({ error: e.message });
    }
}
