import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

import handler from '../tags.js';

async function test() {
    console.log('Testing /api/tags...');
    let result = null;
    const res = {
        status: (code) => ({
            json: (data) => {
                console.log('Status:', code);
                result = data;
            },
            end: () => console.log('end')
        })
    };
    const req = { method: 'GET', query: {} };
    await handler(req, res);
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
}
test();
