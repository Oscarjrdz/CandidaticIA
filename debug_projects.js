
import { getProjects } from './api/utils/storage.js';
async function test() {
    try {
        const projects = await getProjects();
        console.log(JSON.stringify(projects.slice(0, 5), null, 2));
    } catch (e) {
        console.error(e);
    }
}
test();
