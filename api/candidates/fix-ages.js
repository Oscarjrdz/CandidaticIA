/**
 * Fix Ages Endpoint 🎂 (DEBUG MODE V2)
 * POST /api/candidates/fix-ages
 * Rapidly calculates ages for all candidates with birthdates.
 */

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { getCandidates, updateCandidate } = await import('../utils/storage.js');

        // Scan up to 2000 candidates to get everyone
        const { candidates } = await getCandidates(2000, 0);

        const updates = [];
        const log = []; // This will be returned in JSON

        console.log(`🎂 Fix Ages: Scanning ${candidates.length} candidates...`);

        // DEBUG: Look specifically for Miguel Angel
        const miguel = candidates.find(c => c.nombre && c.nombre.toLowerCase().includes('miguel angel'));
        if (miguel) {
            log.push(`🔍 [DEBUG TARGET] FOUND Miguel: ID=${miguel.id}, DOB="${miguel.fechaNacimiento}", Edad="${miguel.edad}"`);
        } else {
            log.push('🔍 [DEBUG TARGET] Miguel Angel NOT FOUND in 2000 items.');
        }

        for (const candidate of candidates) {
            if (!candidate.fechaNacimiento) continue;

            // Normalize DOB
            const dob = candidate.fechaNacimiento.toLowerCase().trim();
            let birthDate = null;
            let debug = false;

            if (candidate.nombre && candidate.nombre.toLowerCase().includes('miguel angel')) {
                debug = true;
                log.push(`  -> Processing DOB: "${dob}" (Length: ${dob.length})`);
                // Check char codes for invisible spaces
                log.push(`  -> Char codes: ${dob.split('').map(c => c.charCodeAt(0)).join(',')}`);
            }

            // Regex for "19 / mayo / 1983" or "19 de mayo de 1983"
            const dateRegex = /(\d{1,2})[\s/-]+(?:de\s+)?([a-z0-9áéíóú]+)[\s/-]+(?:de\s+)?(\d{4})/;
            const match = dob.match(dateRegex);

            if (match) {
                const day = parseInt(match[1]);
                const monthStr = match[2];
                const year = parseInt(match[3]);

                if (debug) log.push(`  -> Match! D:${day} M:${monthStr} Y:${year}`);

                const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
                let monthIndex = months.findIndex(m => m.startsWith(monthStr.slice(0, 3)));

                if (monthIndex === -1 && !isNaN(monthStr)) {
                    monthIndex = parseInt(monthStr) - 1;
                }

                if (monthIndex >= 0) {
                    birthDate = new Date(year, monthIndex, day);
                } else if (debug) log.push(`  -> Bad Month Index for ${monthStr}`);

            } else {
                if (debug) log.push(`  -> No Regex Match`);
                const parts = dob.split(/[/-]/);
                if (parts.length === 3) {
                    // Try parsing simple DD/MM/YYYY
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

                if (debug) log.push(`  -> Calculated Age: ${age}`);

                // Sanity check
                if (age > 15 && age < 100) {
                    const strAge = age.toString();
                    if (candidate.edad !== strAge) {
                        updates.push({ id: candidate.id, edad: strAge });
                        log.push(`${candidate.nombre}: ${dob} -> ${strAge}`);
                    } else {
                        if (debug) log.push(`  -> NO UPDATE NEEDED. Exists: "${candidate.edad}" vs Calc: "${strAge}"`);
                    }
                }
            } else {
                if (debug) log.push(`  -> Invalid Date Object created`);
            }
        }

        console.log(`🎂 Fix Ages: Found ${updates.length} updates needed.`);

        // Batch execution
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
            updatesList: updates.map(u => u.id),
            log: log // Allow user to see logs in response
        });

    } catch (error) {
        console.error('❌ Fix Ages Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
