import { getRedisClient, getProjects } from './api/utils/storage.js';
import dotenv from 'dotenv';
dotenv.config();

async function checkVacancyData() {
    const redis = getRedisClient();
    if (!redis) return;

    try {
        const projs = await getProjects();
        // find aisin project
        const aisin = projs.find(p => p.name.includes('AISIN') || p.name.includes('AYUDANTE'));
        if (!aisin) {
            console.log("Aisin project not found");
            return;
        }

        console.log(`Project: ${aisin.name}, Vacancy ID: ${aisin.vacancyId}`);

        if (aisin.vacancyId) {
            const raw = await redis.get(`vacancy:${aisin.vacancyId}`);
            if (raw) {
                const v = JSON.parse(raw);
                console.log(`Vacancy Name: ${v.name}`);
                console.log(`messageDescription: `, v.messageDescription ? v.messageDescription.substring(0, 50) + "..." : undefined);
                console.log(`Raw keys:`, Object.keys(v));
            } else {
                console.log("Vacancy not found in Redis by that ID");
            }
        }

    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}

checkVacancyData();
