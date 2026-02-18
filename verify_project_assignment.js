/**
 * Verifica si un candidato está correctamente asignado a un proyecto en Redis
 */

import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL, {
    tls: process.env.REDIS_URL.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined
});

const candidateId = process.argv[2];

if (!candidateId) {
    console.error('Usage: node verify_project_assignment.js <candidateId>');
    process.exit(1);
}

async function verify() {
    console.log(`\n🔍 Verificando asignación del candidato: ${candidateId}\n`);

    // 1. Check candidate's projectId field
    const candidate = await redis.get(`candidate:${candidateId}`);
    if (!candidate) {
        console.log('❌ Candidato no encontrado en Redis');
        process.exit(1);
    }

    const candidateData = JSON.parse(candidate);
    console.log(`📋 Datos del candidato:`);
    console.log(`   - Nombre: ${candidateData.nombreReal}`);
    console.log(`   - ProjectId en objeto: ${candidateData.projectId || 'NULL'}`);

    // 2. Check reverse index (candidate -> project)
    const linkedProjectId = await redis.hget('index:cand_project', candidateId);
    console.log(`\n🔗 Índice reverso (index:cand_project):`);
    console.log(`   - Project ID: ${linkedProjectId || 'NULL'}`);

    if (!linkedProjectId) {
        console.log('\n❌ Candidato NO está en el índice reverso');
        redis.disconnect();
        return;
    }

    // 3. Check if candidate is in project's set
    const isInProjectSet = await redis.sismember(`project:candidates:${linkedProjectId}`, candidateId);
    console.log(`\n📦 Set del proyecto (project:candidates:${linkedProjectId}):`);
    console.log(`   - Candidato en set: ${isInProjectSet ? '✅ SÍ' : '❌ NO'}`);

    // 4. Check project metadata
    const metadata = await redis.hget(`project:cand_meta:${linkedProjectId}`, candidateId);
    console.log(`\n📊 Metadata del proyecto (project:cand_meta:${linkedProjectId}):`);
    if (metadata) {
        const meta = JSON.parse(metadata);
        console.log(`   - stepId: ${meta.stepId}`);
        console.log(`   - linkedAt: ${meta.linkedAt}`);
    } else {
        console.log(`   - ❌ No hay metadata`);
    }

    // 5. List ALL candidates in the project
    const allCandidates = await redis.smembers(`project:candidates:${linkedProjectId}`);
    console.log(`\n👥 Total de candidatos en proyecto ${linkedProjectId}: ${allCandidates.length}`);
    if (allCandidates.length <= 10) {
        console.log(`   Candidatos: ${allCandidates.join(', ')}`);
    }

    console.log(`\n✅ Verificación completa`);
    redis.disconnect();
}

verify().catch(err => {
    console.error('Error:', err);
    redis.disconnect();
    process.exit(1);
});
