import { getRedisClient } from '../utils/storage.js';

async function audit() {
    const redis = getRedisClient();
    if (!redis) {
        console.error('No Redis client');
        process.exit(1);
    }

    const keys = [
        'bot_bridge_inicio',
        'bot_bridge_cita',
        'bot_bridge_exit',
        'bot_bridge_citados'
    ];

    console.log('--- STICKERS ---');
    for (const key of keys) {
        const val = await redis.get(key);
        console.log(`${key}: ${val ? 'FOUND' : 'NOT FOUND'} (${val})`);
    }

    const projectId = 'proj_1771225156891_10ez5k';
    const projectRaw = await redis.get(`project:${projectId}`);
    const project = projectRaw ? JSON.parse(projectRaw) : null;

    if (project) {
        console.log('\n--- PROJECT STEPS ---');
        project.steps.forEach(s => {
            console.log(`Step: ${s.name} (ID: ${s.id})`);
            if (s.name.toLowerCase() === 'cita') {
                console.log('Cita Prompt Preview:');
                console.log(s.aiConfig?.prompt?.substring(0, 200) + '...');
            }
        });
    } else {
        console.log('\nProject not found');
    }

    process.exit(0);
}

audit();
