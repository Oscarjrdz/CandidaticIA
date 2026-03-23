import { getRedisClient } from './api/utils/storage.js';

async function q() {
    const r = getRedisClient();
    try {
        const v = await r.get('debug:ultramsg:5218116038195@c.us');
        console.log("STRING 1:", v);
    }catch(e){}
    try {
        const v2 = await r.get('debug:ultramsg:5218116038195');
        console.log("STRING 2:", v2);
    }catch(e){}
    process.exit(0);
}
q();
