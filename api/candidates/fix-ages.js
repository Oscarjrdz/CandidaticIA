/**
 * Fix Ages Endpoint 🎂
 * POST /api/candidates/fix-ages
 * Rapidly calculates ages for all candidates with birthdates.
 */

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        // Allow GET for browser testing
        if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { getCandidates, updateCandidate } = await import('../utils/storage.js');

        // Scan up to 2000 candidates to get everyone
        const { candidates } = await getCandidates(2000, 0);

        const updates = [];
        const log = [];

        console.log(`🎂 Fix Ages: Scanning ${candidates.length} candidates...`);

        for (const candidate of candidates) {
            if (!candidate.fechaNacimiento) continue;

            // Re-calculate even if age exists (to fix previous bad calcs)
            // Or only if missing? Let's fix bad dashes too.
            if (candidate.edad && candidate.edad.length > 0 && candidate.edad !== '-' && candidate.edad !== 'INVALID') {
                // Skip valid formatted ages to save time? 
                // Actually, verify calculation is cheap.
            }

            const dob = candidate.fechaNacimiento.toLowerCase().trim();
            let birthDate = null;

            // Regex for "19 / mayo / 1983" or "19 de mayo de 1983"
            const dateRegex = /(\d{1,2})[\s/-]+(?:de\s+)?([a-z0-9áéíóú]+)[\s/-]+(?:de\s+)?(\d{4})/;
            const match = dob.match(dateRegex);

            if (match) {
                const day = parseInt(match[1]);
                const monthStr = match[2];
                const year = parseInt(match[3]);

                const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
                let monthIndex = months.findIndex(m => m.startsWith(monthStr.slice(0, 3)));

                if (monthIndex === -1 && !isNaN(monthStr)) {
                    monthIndex = parseInt(monthStr) - 1;
                }

                if (monthIndex >= 0) {
                    birthDate = new Date(year, monthIndex, day);
                }
            } else {
                const parts = dob.split(/[/-]/);
                if (parts.length === 3) {
                    const d = parseInt(parts[0]);
                    const m = parseInt(parts[1]) - 1;
                    const y = parseInt(parts[2]);
                    if (!isNaN(d) && !isNaN(m) && !isNaN(y)) {
                        birthDate = new Date(y, m, d);
                    }
                }
            }

            if (birthDate && !isNaN(birthDate.getTime())) {
                const today = new Date();
                let age = today.getFullYear() - birthDate.getFullYear();
                const m = today.getMonth() - birthDate.getMonth();
                if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
                    age--;
                }

                // Sanity check
                if (age > 15 && age < 100) {
                    const strAge = age.toString();
                    if (candidate.edad !== strAge) {
                        updates.push({ id: candidate.id, edad: strAge });
                        log.push(`${candidate.nombre}: ${dob} -> ${strAge}`);
                    }
                }
            }
        }

        console.log(`🎂 Fix Ages: Found ${updates.length} updates needed.`);

        // Batch execution (Parallel promises)
        const BATCH_SIZE = 50;
        let processed = 0;

        for (let i = 0; i < updates.length; i += BATCH_SIZE) {
            const batch = updates.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map(u => updateCandidate(u.id, { edad: u.edad })));
            processed += batch.length;
            console.log(`🎂 Processed ${processed}/${updates.length}`);
        }

        return res.status(200).json({
            success: true,
            totalScanned: candidates.length,
            updated: updates.length,
            log: log.slice(0, 50) // Return first 50 logs
        });

    } catch (error) {
        console.error('❌ Fix Ages Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
