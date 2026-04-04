import { getProjects, getVacancies } from './api/utils/storage.js';

async function test() {
    const p = await getProjects();
    const v = await getVacancies();
    console.log(JSON.stringify(p.slice(-2), null, 2));
    console.log(JSON.stringify(v.slice(-2), null, 2));
    process.exit(0);
}
test();
