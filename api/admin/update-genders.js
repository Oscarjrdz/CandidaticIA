import { getCandidates, updateCandidate } from '../utils/storage.js';
import { detectGender } from '../utils/ai.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Security check - optional but good to have a simple key
    const { key } = req.query;
    if (key !== 'oscar_detect_2026') {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        console.log('🚀 Triggering Global Gender Update from API...');
        const { candidates } = await getCandidates(2000, 0);

        const results = {
            total: candidates.length,
            updated: 0,
            skipped: 0,
            logs: []
        };

        for (const candidate of candidates) {
            const nameToUse = candidate.nombreReal || candidate.nombre;

            // Log for every single candidate
            const logEntry = {
                id: candidate.id,
                name: nameToUse,
                reason: ''
            };

            if (candidate.genero && candidate.genero !== 'Desconocido') {
                results.skipped++;
                logEntry.reason = 'Already has gender';
                results.logs.push(logEntry);
                continue;
            }

            if (!nameToUse || nameToUse === 'Sin nombre' || nameToUse.trim().length < 2) {
                results.skipped++;
                logEntry.reason = 'Name too short or empty';
                results.logs.push(logEntry);
                continue;
            }

            const gender = await detectGender(nameToUse);

            if (gender === 'Hombre' || gender === 'Mujer') {
                await updateCandidate(candidate.id, { genero: gender });
                results.updated++;
                logEntry.reason = `Success: ${gender}`;
                results.logs.push(logEntry);
            } else {
                results.skipped++;
                logEntry.reason = `AI returned: ${gender}`;
                results.logs.push(logEntry);
            }

            // Limit to 100 logs per request to avoid huge payloads
            if (results.logs.length >= 100) break;

            // Limit to 30 updates per request to be very safe with Vercel timeouts
            if (results.updated >= 30) {
                results.message = "Partial update complete (limit 30). Run again.";
                break;
            }
        }

        return res.status(200).json({
            success: true,
            results
        });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
