import { getProjectById } from './api/utils/storage.js';

async function run() {
    const proj = await getProjectById('proj_1771225156891_10ez5k');
    console.log(JSON.stringify(proj, null, 2));
    process.exit(0);
}
run();
