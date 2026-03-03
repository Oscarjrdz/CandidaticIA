import Redis from 'ioredis';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INBOX_DIR = path.join(__dirname, '../../dev_inbox');

async function main() {
    console.log("Connecting to Redis...");
    const redis = new Redis('redis://default:8XMrmngeeqQ0p7MZRRBXycnhMG8WD5wt@redis-10341.c258.us-east-1-4.ec2.cloud.redislabs.com:10341');

    try {
        let mediaUrl = await redis.get('dev_last_screenshot');

        if (!mediaUrl || mediaUrl === 'null') {
            console.log("No screenshot found in Redis.");
            process.exit(0);
        }
        
        console.log(`[DEV INBOX] Found URL: ${mediaUrl}`);

        if (!fs.existsSync(INBOX_DIR)) {
            fs.mkdirSync(INBOX_DIR, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const ext = mediaUrl.includes('.png') ? '.png' : '.jpg';
        const filename = `screenshot_${timestamp}${ext}`;
        const filepath = path.join(INBOX_DIR, filename);
        
        console.log(`Downloading to ${filepath}...`);
        const fileResponse = await axios({
            method: 'GET',
            url: mediaUrl,
            responseType: 'stream'
        });

        const writer = fs.createWriteStream(filepath);
        fileResponse.data.pipe(writer);

        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        console.log(`✅ Screenshot downloaded successfully!`);
        process.exit(0);
    } catch (e) {
        console.error("Error:", e.message);
        process.exit(1);
    }
}

main();
