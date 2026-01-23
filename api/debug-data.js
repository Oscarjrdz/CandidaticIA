import { getRedisClient } from './utils/storage.js';

export default async function handler(req, res) {
    const client = getRedisClient();
    if (!client) return res.status(500).json({ error: 'No Redis Client' });

    try {
        // 1. ZCARD (Total Scan)
        const candidatesCount = await client.zcard('candidates:list');

        // 2. Sample Header
        const first5 = await client.zrevrange('candidates:list', 0, 4);

        // 3. Bulks stats
        const bulksCount = await client.zcard('bulks:list');

        // 4. Test Connectivity/Pipeline with first 100
        const first100 = await client.zrevrange('candidates:list', 0, 99);
        let pipelineSuccess = 'Not Tested';
        let sampleItem = null;

        if (first100.length > 0) {
            const pipe = client.pipeline();
            first100.forEach(id => pipe.get(`candidate:${id}`));
            const results = await pipe.exec();
            pipelineSuccess = results.every(r => r[0] === null) ? 'OK' : 'Errors Detected';
            // Check first result
            if (results[0] && results[0][1]) {
                sampleItem = JSON.parse(results[0][1]);
            }
        }

        // 5. LEGACY DATA CHECK
        const legacyBlob = await client.get('candidatic_candidates');
        const legacySimple = await client.get('candidates');
        let legacyCount = 0;
        if (legacyBlob) {
            try { legacyCount = JSON.parse(legacyBlob).length; } catch (e) { }
        } else if (legacySimple) {
            try { legacyCount = JSON.parse(legacySimple).length; } catch (e) { }
        }

        return res.json({
            candidates_distributed_count: candidatesCount, // Current System
            legacy_blob_found: !!legacyBlob || !!legacySimple,
            legacy_blob_count: legacyCount,
            candidates_sample_ids: first5,
            candidates_zrange_check: first100.length,
            pipeline_status: pipelineSuccess,
            sample_candidate: sampleItem ? { id: sampleItem.id, phone: sampleItem.whatsapp } : 'null',
            bulks_zcard: bulksCount,
            environment: process.env.NODE_ENV,
            timestamp: new Date().toISOString()
        });
    } catch (e) {
        return res.status(500).json({ error: e.message, stack: e.stack });
    }
}
