import { getCandidates } from '../utils/storage.js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

async function findTags() {
    console.log('Obteniendo todos los candidatos...');
    const { candidates } = await getCandidates(20000, 0, '');
    
    const uniqueTags = new Set();
    const tagCounts = {};

    candidates.forEach(c => {
        if (Array.isArray(c.tags)) {
            c.tags.forEach(t => {
                uniqueTags.add(t);
                tagCounts[t] = (tagCounts[t] || 0) + 1;
            });
        }
    });

    console.log('\n--- Todas las etiquetas encontradas en candidatos ---');
    [...uniqueTags].sort().forEach(t => {
        console.log(`"${t}": ${tagCounts[t]} candidatos`);
    });
    
    // Y veamos qué tiene el user
    const { getRedisClient } = await import('../utils/storage.js');
    const redis = getRedisClient();
    const rawUsers = await redis.get('candidatic_users');
    const users = rawUsers ? JSON.parse(rawUsers) : [];
    
    console.log('\n--- Permisos allowed_labels de usuarios ---');
    users.forEach(u => {
        if (u.allowed_labels && u.allowed_labels.length > 0) {
            console.log(`User ${u.email}:`, u.allowed_labels);
        }
    });

    process.exit(0);
}

findTags().catch(e => {
    console.error(e);
    process.exit(1);
});
