import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INBOX_DIR = path.join(__dirname, '../../dev_inbox');

/**
 * Downloads an image from a URL and saves it to the local dev_inbox directory.
 * Used exclusively for debugging and screenshot sharing with the AI.
 */
export async function downloadDevScreenshot(mediaUrl, phone) {
    if (!mediaUrl || process.env.NODE_ENV === 'production') return null; // Only for local dev

    try {
        if (!fs.existsSync(INBOX_DIR)) {
            fs.mkdirSync(INBOX_DIR, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const ext = mediaUrl.includes('.png') ? '.png' : '.jpg';
        const filename = `screenshot_${phone}_${timestamp}${ext}`;
        const filepath = path.join(INBOX_DIR, filename);

        const response = await axios({
            method: 'GET',
            url: mediaUrl,
            responseType: 'stream'
        });

        const writer = fs.createWriteStream(filepath);

        return new Promise((resolve, reject) => {
            response.data.pipe(writer);
            let error = null;
            writer.on('error', err => {
                error = err;
                writer.close();
                reject(err);
            });
            writer.on('close', () => {
                if (!error) {
                    console.log(`[DEV INBOX] 📸 Screenshot saved: ${filepath}`);
                    resolve(filepath);
                }
            });
        });
    } catch (e) {
        console.error('[DEV INBOX] Failed to download screenshot:', e.message);
        return null;
    }
}
