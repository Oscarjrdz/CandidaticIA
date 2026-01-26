/**
 * NASCAR Cleanup Endpoint 🏎️🏁
 * POST /api/candidates/cleanup
 * Force AI cleaning for all candidates with missing or dirty data.
 */

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { getCandidates, updateCandidate } = await import('../utils/storage.js');
        const { cleanNameWithAI, detectGender, cleanMunicipioWithAI } = await import('../utils/ai.js');

        // 🏎️ Scan the first 1000 candidates (Deep clean & Re-Sort)
        const { candidates } = await getCandidates(1000, 0);

        const dirtyCandidates = candidates.filter(c =>
            !c.genero ||
            (c.nombreReal && c.nombreReal.includes('*')) ||
            (!c.municipio || c.municipio.length < 3) ||
            (c.fechaNacimiento && !c.edad) // New Check: Missing Age
        );

        console.log(`🏎️ NASCAR Motor: Analysis complete. Found ${dirtyCandidates.length} dirty candidates out of ${candidates.length}.`);

        const results = [];
        const processedIds = new Set();

        // 1. Process Dirty Candidates (AI Heavy)
        for (const candidate of dirtyCandidates) {
            try {
                const updates = {};

                // 1. Clean Name & Gender
                if (!candidate.genero || (candidate.nombreReal && candidate.nombreReal.includes('*'))) {
                    const targetName = candidate.nombreReal || candidate.nombre || 'Candidato';
                    const cleanedName = await cleanNameWithAI(targetName);

                    // Handle NULL (INVALID) from cleanNameWithAI
                    if (cleanedName === null) {
                        updates.nombreReal = null; // Delete garbage
                        console.log(`🗑️ Deleting invalid name for ${candidate.id}`);
                    } else if (cleanedName !== candidate.nombreReal) {
                        updates.nombreReal = cleanedName;
                        const gender = await detectGender(cleanedName);
                        if (gender !== 'Desconocido') updates.genero = gender;
                    }
                }

                // 2. Clean Municipality
                if (!candidate.municipio || candidate.municipio.length < 3) {
                    if (candidate.municipio) {
                        const cleanedMuni = await cleanMunicipioWithAI(candidate.municipio);
                        updates.municipio = cleanedMuni;
                    }
                }

                // 3. Calculate Age from BirthDate (NASCAR V2)
                // Also update if missing edad or logic refresh desired
                if (candidate.fechaNacimiento && (!candidate.edad || candidate.edad === '-')) {
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

                        // Fix: if month is number in string
                        if (monthIndex === -1 && !isNaN(monthStr)) {
                            monthIndex = parseInt(monthStr) - 1;
                        }

                        if (monthIndex >= 0) {
                            birthDate = new Date(year, monthIndex, day);
                        }
                    } else {
                        // Fallback DD/MM/YYYY
                        const parts = dob.split(/[/-]/);
                        if (parts.length === 3) {
                            // Assuming DD/MM/YYYY
                            birthDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
                        }
                    }

                    if (birthDate && !isNaN(birthDate.getTime())) {
                        const today = new Date();
                        let age = today.getFullYear() - birthDate.getFullYear();
                        const m = today.getMonth() - birthDate.getMonth();
                        if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
                            age--;
                        }
                        if (age > 15 && age < 100) {
                            updates.edad = age.toString();
                            console.log(`🎂 Calculated Age for ${candidate.id}: ${age}`);
                        }
                    }
                }

                // Always update if dirty (this also fixes Sort Score)
                if (Object.keys(updates).length > 0) {
                    await updateCandidate(candidate.id, updates);
                    results.push({ id: candidate.id, status: 'cleaned' });
                    processedIds.add(candidate.id);
                }
            } catch (err) {
                console.error(`❌ Cleanup failed for candidate ${candidate.id}:`, err.message);
            }
        }

        // 2. RE-SORT FORCE (Refresh Score for everyone else)
        // This ensures the "Last Message Sort" is applied to existing clean candidates too.
        let resortCount = 0;
        for (const candidate of candidates) {
            if (!processedIds.has(candidate.id)) {
                // Call update with empty object to trigger saveCandidate -> refresh score
                // Score logic inside saveCandidate uses ultimoMensaje || primerContacto || now
                await updateCandidate(candidate.id, {});
                resortCount++;
            }
        }
        console.log(`🏎️ NASCAR Motor: Re-sorted ${resortCount} clean candidates.`);

        return res.status(200).json({
            success: true,
            processed: dirtyCandidates.length,
            cleaned: results.length,
            resorted: resortCount,
            message: `Motor NASCAR completó la limpieza de ${results.length} perfiles y reordenó ${resortCount} candidatos.`
        });

    } catch (error) {
        console.error('❌ NASCAR Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
