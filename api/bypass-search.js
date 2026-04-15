/**
 * ByPass Search API — Minería de Candidatos
 * POST /api/bypass-search
 * 
 * Searches ALL candidates (no limit) that:
 * 1. Have NO project assigned (proyecto === 0)
 * 2. Match the bypass rule criteria (age, gender, municipio, escolaridad, categoría)
 * 
 * Reuses the same matching logic from the Orchestrator for consistency.
 */
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    try {
        const { getCandidates, getRedisClient } = await import('./utils/storage.js');

        const { minAge, maxAge, municipios, escolaridades, categories, gender } = req.body;

        // 1. Fetch ALL candidates (no limit) — server-side, no 200 cap
        const { candidates: allCandidates } = await getCandidates(50000, 0, '', false, '');

        const client = getRedisClient();

        // 2. Get linked candidate IDs (those already in projects)
        const CANDIDATE_PROJECT_LINK = 'candidates:project_link';
        const linkedIdsArray = client ? await client.hkeys(CANDIDATE_PROJECT_LINK) : [];
        const linkedIds = new Set(linkedIdsArray);

        // 3. Normalize helper (same as Orchestrator)
        const normalizeStr = (s) => (s || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

        // 4. Filter candidates
        const results = allCandidates.filter(c => {
            // Must NOT be in a project
            if (linkedIds.has(c.id)) return false;
            if (c.projectId || c.projectMetadata?.projectId) return false;

            // Age filter
            const cAge = parseInt(c.edad);
            if (!isNaN(cAge)) {
                if (minAge && cAge < parseInt(minAge)) return false;
                if (maxAge && cAge > parseInt(maxAge)) return false;
            } else if (minAge || maxAge) {
                // If rule requires age range but candidate has no age, skip
                return false;
            }

            // Gender filter
            const cGender = (c.genero || '').toLowerCase();
            const rGender = (gender || 'Cualquiera').toLowerCase();
            if (rGender !== 'cualquiera' && cGender !== rGender) return false;

            // Category filter
            const cCat = (c.categoria || '').toLowerCase().trim();
            if (categories && categories.length > 0) {
                const isMatch = categories.some(rc => {
                    const rCat = rc.toLowerCase().trim();
                    return rCat.includes(cCat) || cCat.includes(rCat);
                });
                if (!isMatch) return false;
            }

            // Municipio filter
            const cMun = normalizeStr(c.municipio);
            if (municipios && municipios.length > 0) {
                const isMatch = municipios.some(rm => {
                    const rMun = normalizeStr(rm);
                    return rMun.includes(cMun) || cMun.includes(rMun);
                });
                if (!isMatch) return false;
            }

            // Escolaridad filter
            const cEsc = normalizeStr(c.escolaridad);
            if (escolaridades && escolaridades.length > 0) {
                const isMatch = escolaridades.some(re => {
                    const rEsc = normalizeStr(re);
                    return rEsc.includes(cEsc) || cEsc.includes(rEsc);
                });
                if (!isMatch) return false;
            }

            return true;
        });

        // Return lightweight results (only fields needed for display)
        const lightResults = results.map(c => ({
            id: c.id,
            nombreReal: c.nombreReal || c.nombre || c.whatsapp,
            whatsapp: c.whatsapp,
            edad: c.edad || '-',
            municipio: c.municipio || '-',
            escolaridad: c.escolaridad || '-',
            categoria: c.categoria || '-',
            genero: c.genero || '-',
            tags: c.tags || []
        }));

        return res.status(200).json({
            success: true,
            count: lightResults.length,
            totalScanned: allCandidates.length,
            candidates: lightResults
        });

    } catch (error) {
        console.error('❌ ByPass Search Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
