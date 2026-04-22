import Redis from 'ioredis';

const redisUrl = "redis://default:8XMrmngeeqQ0p7MZRRBXycnhMG8WD5wt@redis-10341.c258.us-east-1-4.ec2.cloud.redislabs.com:10341";
const redis = new Redis(redisUrl, { retryStrategy: (times) => Math.min(times * 50, 2000) });

async function run() {
    try {
        console.log("Fetching bulk history...");
        const rawHistory = await redis.get('bulks:history');
        const history = rawHistory ? JSON.parse(rawHistory) : [];
        if (history.length === 0) {
            console.log("No history found.");
            return;
        }

        // Get the latest one
        const latest = history[0];
        console.log(`Latest campaign: ${latest.name || 'Unnamed'} (${latest.id})`);
        
        let duplicateCount = 0;
        let candidatesChecked = 0;
        const candidates = latest.candidates || [];
        
        console.log(`Checking ${candidates.length} candidates...`);
        let triplicated = 0;
        let duplicated = 0;

        for (const cid of candidates) {
            candidatesChecked++;
            const rawMsgs = await redis.lrange(`messages:${cid}`, 0, -1);
            const messages = rawMsgs.map(r => JSON.parse(r));
            
            // Look for recent messages sent by "me" within the last 1-2 hours
            // Or look for identical content grouped together
            const recentBotMsgs = messages.filter(m => m.from === 'me');
            
            // Check if there are identical messages with similar timestamps
            if (recentBotMsgs.length > 0) {
                const contentCounts = {};
                for (const m of recentBotMsgs) {
                    if (Date.now() - Number(m.timestamp) < 2 * 60 * 60 * 1000) { // last 2 hours
                        contentCounts[m.content] = (contentCounts[m.content] || 0) + 1;
                    }
                }
                
                let maxDupes = 0;
                for (const count of Object.values(contentCounts)) {
                    if (count > maxDupes) maxDupes = count;
                }
                
                if (maxDupes > 1) {
                    duplicateCount++;
                    if (maxDupes === 3) triplicated++;
                    if (maxDupes === 2) duplicated++;
                }
            }
        }
        
        console.log(`-----------------------------------`);
        console.log(`Scan complete!`);
        console.log(`Total Candidates Checked: ${candidatesChecked}`);
        console.log(`Candidates with duplicated messages: ${duplicateCount}`);
        console.log(`  - 2x duplicates: ${duplicated}`);
        console.log(`  - 3x or more duplicates: ${triplicated}`);
        console.log(`-----------------------------------`);

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

run();
