
import fs from 'fs';
import path from 'path';

const loadEnv = () => {
    try {
        const envPath = path.resolve(process.cwd(), '.env.local');
        if (fs.existsSync(envPath)) {
            const envConfig = fs.readFileSync(envPath, 'utf8');
            envConfig.split('\n').forEach(line => {
                const [key, val] = line.split('=');
                if (key && val) {
                    process.env[key.trim()] = val.trim();
                }
            });

            // Polyfill REDIS_URL if missing
            if (!process.env.REDIS_URL) {
                if (process.env.UPSTASH_REDIS_REST_URL) {
                    process.env.REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
                }
            }
            console.log('✅ Environment loaded from .env.local');
        }
    } catch (e) {
        console.error('Error loading env:', e);
    }
};

loadEnv();
