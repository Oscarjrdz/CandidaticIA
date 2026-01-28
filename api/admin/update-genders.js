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
            const currentGender = candidate.genero;

            // Check if already has a SET gender (Hombre, Mujer, or ALREADY marked as Desconocido)
            const hasFinalStatus = currentGender === 'Hombre' || currentGender === 'Mujer' || currentGender === 'Desconocido';
            const isError = currentGender && (currentGender.includes('Error') || currentGender.includes('[GoogleGenerativeAI'));

            if (hasFinalStatus && !isError && force !== 'true') {
                results.skipped++;
                continue; // Skip silently
            }

            // CLEAN Junk names (Emojis-only or just numbers)
            const isJunk = !/[a-zA-ZáéíóúÁÉÍÓÚñÑ]/.test(nameToUse || "");
            if (isJunk || !nameToUse || nameToUse === 'Sin nombre' || nameToUse.trim().length < 2) {
                await updateCandidate(candidate.id, { genero: 'Desconocido' });
                results.skipped++;
                results.logs.push({ name: nameToUse || "Empty", reason: "Junk name (emojis/numbers), marked as Desconocido" });
                continue;
            }

            const gender = await detectGender(nameToUse);

            // SAVE whatever AI says (including Desconocido) to move on
            await updateCandidate(candidate.id, { genero: gender });

            if (gender === 'Hombre' || gender === 'Mujer') {
                results.updated++;
                results.logs.push({ name: nameToUse, result: gender });
            } else {
                results.skipped++;
                results.logs.push({ name: nameToUse, reason: `AI confirmed: ${gender}` });
            }

            // Batch limit to avoid Vercel 10s timeout
            if (results.updated + results.logs.filter(l => l.reason).length >= 10) {
                results.message = "Lote procesado. Refresca para seguir con los faltantes.";
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
