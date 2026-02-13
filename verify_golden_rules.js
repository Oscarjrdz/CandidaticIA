import queryHandler from './api/ai/query.js';
import projectsHandler from './api/projects.js';
import candidatesHandler from './api/candidates.js';
import { saveCandidate, deleteCandidate, getRedisClient } from './api/utils/storage.js';

async function verifyGoldenRules() {
    console.log('🚀 Starting DIRECT Verification (No Server Required)... \n');

    const mockRes = (label, resolve) => ({
        status: (code) => ({
            json: (data) => {
                console.log(`[${label}] Status ${code}:`, JSON.stringify(data, null, 2).substring(0, 200) + '...');
                resolve(data);
            },
            end: () => resolve({ success: true })
        }),
        setHeader: () => { }
    });

    try {
        // 1. Setup Projects
        console.log('--- Phase 1: Setup Projects ---');
        const projA = await new Promise(resolve => {
            projectsHandler({ method: 'POST', body: { name: 'Project Alpha', description: 'Test A' } }, mockRes('Create Proj A', resolve));
        });
        const projB = await new Promise(resolve => {
            projectsHandler({ method: 'POST', body: { name: 'Project Beta', description: 'Test B' } }, mockRes('Create Proj B', resolve));
        });

        // 2. Setup Candidate (Force a complete one for exclusion rule test)
        console.log('\n--- Phase 2: Setup Candidate ---');
        const candId = `verify_${Date.now()}`;
        const candData = {
            id: candId,
            nombreReal: 'Tester Verification Expert',
            genero: 'Hombre',
            municipio: 'Monterrey',
            fechaNacimiento: '01/01/1990',
            categoria: 'Transporte',
            escolaridad: 'Preparatoria',
            whatsapp: '5218116038195',
            tieneEmpleo: 'Sí'
        };
        await saveCandidate(candData);
        console.log(`✅ Created Candidate: ${candId}`);

        // 3. Link Candidate to Project A
        console.log('\n--- Phase 3: Link to Project A ---');
        const linkData = await new Promise(resolve => {
            projectsHandler({ method: 'POST', body: { action: 'link', projectId: projA.project.id, candidateId: candId } }, mockRes('Link A', resolve));
        });

        // 4. Test Search Exclusion
        console.log('\n--- Phase 4: AI Search Exclusion ---');
        const searchExcludeData = await new Promise(resolve => {
            queryHandler({ method: 'POST', body: { query: 'Tester Verification Expert', excludeLinked: true } }, mockRes('Search Exclude', resolve));
        });
        const foundExcluded = searchExcludeData.candidates.some(c => c.id === candId);
        console.log(`🔍 Search with excludeLinked=true: Found? ${foundExcluded} (Expected: false)`);

        const searchIncludeData = await new Promise(resolve => {
            queryHandler({ method: 'POST', body: { query: 'Tester Verification Expert', excludeLinked: false } }, mockRes('Search Include', resolve));
        });
        const foundIncluded = searchIncludeData.candidates.some(c => c.id === candId);
        console.log(`🔍 Search with excludeLinked=false: Found? ${foundIncluded} (Expected: true)`);

        // 5. Test Migration to Project B
        console.log('\n--- Phase 5: One-Project Migration ---');
        const migrateData = await new Promise(resolve => {
            projectsHandler({ method: 'POST', body: { action: 'link', projectId: projB.project.id, candidateId: candId } }, mockRes('Link B (Migrate)', resolve));
        });
        console.log(`🔄 Migration Reported? ${migrateData.migrated} (Expected: true)`);

        // 6. Verify Removal from Project A
        console.log('\n--- Phase 6: Verify Migration Success ---');
        const candAData = await new Promise(resolve => {
            projectsHandler({ method: 'GET', query: { id: projA.project.id, view: 'candidates' } }, mockRes('View Proj A', resolve));
        });
        const stillInA = candAData.candidates.some(c => c.id === candId);
        console.log(`🛡️ Still in Project Alpha? ${stillInA} (Expected: false)`);

        const candBData = await new Promise(resolve => {
            projectsHandler({ method: 'GET', query: { id: projB.project.id, view: 'candidates' } }, mockRes('View Proj B', resolve));
        });
        const nowInB = candBData.candidates.some(c => c.id === candId);
        console.log(`🎯 Now in Project Beta? ${nowInB} (Expected: true)`);

        console.log('\n✨ VERIFICATION COMPLETE');

        // Cleanup (Optional)
        // await deleteCandidate(candId);
        process.exit(0);

    } catch (e) {
        console.error('\n❌ VERIFICATION FAILED:', e);
        process.exit(1);
    }
}

verifyGoldenRules();
