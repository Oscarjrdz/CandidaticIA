import { getRedisClient, getCandidates, updateCandidate } from '../utils/storage.js';

export default async function handler(req, res) {
    // Basic protection (optional but recommended during live use)
    // if (req.headers.authorization !== `Bearer ${process.env.WEBHOOK_SECRET}`) {
    //     return res.status(401).json({ error: 'Unauthorized' });
    // }

    try {
        const redis = getRedisClient();
        if (!redis) return res.status(500).json({ error: 'Redis no disponible' });

        const { candidates } = await getCandidates(5000, 0);
        if (!candidates) return res.status(200).json({ success: true, count: 0 });

        let updatedCount = 0;
        const invalidValues = ['n/a', 'na', 'ninguno', 'none', 'n/na', 'nan'];

        for (const cand of candidates) {
            let needsUpdate = false;
            const updates = {};

            const fieldsToCheck = [
                'nombreReal', 'municipio', 'fechaNacimiento', 'genero',
                'categoria', 'tieneEmpleo', 'escolaridad', 'empresa', 'puesto'
            ];

            for (const field of fieldsToCheck) {
                const rawVal = cand[field];
                if (!rawVal) continue;

                const val = rawVal.toString().toLowerCase().trim();
                if (invalidValues.includes(val)) {
                    updates[field] = 'No proporcionado';
                    needsUpdate = true;
                }
            }

            if (needsUpdate) {
                console.log(`🧹 Purging N/A from candidate ${cand.whatsapp}...`);
                await updateCandidate(cand.id, updates);
                updatedCount++;
            }
        }

        return res.status(200).json({
            success: true,
            message: `Limpieza terminada. Se actualizaron ${updatedCount} candidatos.`,
            updatedCount
        });

    } catch (error) {
        console.error('Purge API Error:', error);
        return res.status(500).json({ error: error.message });
    }
}
