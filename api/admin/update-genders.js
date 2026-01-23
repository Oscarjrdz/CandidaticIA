import { getCandidates, updateCandidate } from '../utils/storage.js';
import { detectGender } from '../utils/ai.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { key, force } = req.query;
    if (key !== 'oscar_detect_2026') {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        console.log('🚀 Triggering Global Gender Update (v1.4)...');
        const { candidates: allCandidates } = await getCandidates(2000, 0);

        // Sort: process those with names first
        const candidates = allCandidates.sort((a, b) => {
            const nameA = a.nombreReal || a.nombre || "";
            const nameB = b.nombreReal || b.nombre || "";
            return nameB.length - nameA.length;
        });

        const results = {
            build: "v1.5-final-fix",
            total_in_db: candidates.length,
            updated: 0,
            skipped: 0,
            logs: []
        };

        for (const candidate of candidates) {
            const nameToUse = candidate.nombreReal || candidate.nombre;

            // CLEAN Junk names
            if (!nameToUse || nameToUse === 'Sin nombre' || nameToUse.trim().length < 2) {
                results.skipped++;
                continue;
            }

            // Check if already has gender (and it's not an error message)
            const currentGender = candidate.genero;
            const isError = currentGender && (currentGender.includes('Error') || currentGender.includes('[GoogleGenerativeAI'));
            const hasValidGender = currentGender && currentGender !== 'Desconocido' && !isError;

            if (hasValidGender && force !== 'true') {
                results.skipped++;
                // Silently skip to keep logs small
                continue;
            }

            // If we are here, it's either:
            // 1. missing gender
            // 2. it's "Desconocido"
            // 3. it's an Error message (Auto-retry enabled)
            // 4. Force mode is ON

            const gender = await detectGender(nameToUse);

            if (gender === 'Hombre' || gender === 'Mujer') {
                await updateCandidate(candidate.id, { genero: gender });
                results.updated++;
                results.logs.push({ name: nameToUse, result: gender });
            } else {
                results.skipped++;
                results.logs.push({ name: nameToUse, reason: `AI returned ${gender}` });
            }

            // Safety limit per batch: 5 candidates (AI is slow, avoid Vercel 10s timeout)
            if (results.updated >= 5) {
                results.message = "Batch of 5 complete. Refresh to continue.";
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
