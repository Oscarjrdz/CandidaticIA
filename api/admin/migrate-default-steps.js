
import { getRedisClient, updateProjectSteps, getProjects } from '../../utils/storage.js';

/**
 * API Handler for Migrating Project Steps to Immutable Default Step
 * Access: /api/admin/migrate-default-steps
 */
export default async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Optional: Add a simple secret check if needed, or rely on admin role.
    // const { secret } = req.query;

    console.log('--- 🛡️ STARTING MIGRATION (API): IMMUTABLE DEFAULT STEPS ---');
    const logs = [];
    const log = (msg) => {
        console.log(msg);
        logs.push(msg);
    };

    const client = getRedisClient();
    if (!client) {
        return res.status(500).json({ error: 'Redis client not initialized' });
    }

    try {
        const projects = await getProjects();
        log(`📋 Found ${projects.length} projects.`);

        let stats = { processed: 0, migrated: 0, candidatesMoved: 0, errors: 0 };

        for (const p of projects) {
            try {
                log(`\n🔹 Processing Project: "${p.name}" (${p.id})`);

                // 1. Create Default if missing
                if (!p.steps || p.steps.length === 0) {
                    log('   ⚠️ No steps found. Creating default step...');
                    const newSteps = [{ id: 'step_default', name: 'Inicio', locked: true }];
                    await updateProjectSteps(p.id, newSteps);
                    log('   ✅ Created default step.');
                    stats.processed++;
                    continue;
                }

                // 2. Check overlap
                if (p.steps.some(s => s.id === 'step_default')) {
                    log('   ✅ Already has "step_default". Keeping structure.');
                    // Ensure locked
                    const defaultStep = p.steps.find(s => s.id === 'step_default');
                    if (!defaultStep.locked) {
                        defaultStep.locked = true;
                        // Build full updated steps array preserving others
                        const updatedSteps = p.steps.map(s => s.id === 'step_default' ? { ...s, locked: true } : s);
                        await updateProjectSteps(p.id, updatedSteps);
                        log('   🔒 Locked existing "step_default".');
                    }
                    stats.processed++;
                    continue;
                }

                // 3. ACTUAL MIGRATION
                const firstStep = p.steps[0];
                const oldId = firstStep.id;
                log(`   🔄 Migrating first step "${firstStep.name}" (ID: ${oldId}) -> "step_default"`);

                // Update Step Definition
                const updatedSteps = p.steps.map((s, idx) => {
                    if (idx === 0) return { ...s, id: 'step_default', locked: true };
                    return s;
                });

                await updateProjectSteps(p.id, updatedSteps);
                log('   ✅ Project steps updated.');

                // 4. Migrate Candidates (Heavy Scan)
                // In API route, we must be careful with timeout (Vercel has 10s limit on free).
                // We will iterate candidates using the storage utility logic if possible? 
                // No, storage.js doesn't expose a "getAllCandidates".
                // We'll use the raw client scan for now, assuming dataset fits in memory/time.

                const candidateKeys = await client.keys('candidatic:candidate:*');
                let movedInProject = 0;

                for (const key of candidateKeys) {
                    const cData = await client.get(key);
                    if (!cData) continue;
                    const c = JSON.parse(cData);

                    if (c.projectId === p.id && (c.stepId === oldId || c.projectMetadata?.stepId === oldId)) {
                        let changed = false;
                        if (c.stepId === oldId) { c.stepId = 'step_default'; changed = true; }
                        if (c.projectMetadata?.stepId === oldId) { c.projectMetadata.stepId = 'step_default'; changed = true; }

                        if (changed) {
                            await client.set(key, JSON.stringify(c));
                            movedInProject++;
                        }
                    }
                }

                log(`   📦 Moved ${movedInProject} candidates from "${oldId}" to "step_default".`);
                stats.candidatesMoved += movedInProject;
                stats.migrated++;

            } catch (err) {
                log(`   ❌ Error processing project ${p.id}: ${err.message}`);
                stats.errors++;
            }
        }

        log('\n--- 🎉 MIGRATION COMPLETE ---');
        return res.status(200).json({ success: true, stats, logs });

    } catch (error) {
        console.error('❌ Migration Fatal Error:', error);
        return res.status(500).json({ success: false, error: error.message, logs });
    }
}
