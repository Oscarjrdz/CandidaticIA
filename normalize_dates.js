import Redis from 'ioredis';

const redisUrl = "redis://default:8XMrmngeeqQ0p7MZRRBXycnhMG8WD5wt@redis-10341.c258.us-east-1-4.ec2.cloud.redislabs.com:10341";
const redis = new Redis(redisUrl, { retryStrategy: (times) => Math.min(times * 50, 2000) });

function normalizeDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return dateStr;
    let clean = dateStr.trim();
    
    // If it's empty or some placeholder like N/A
    if (!clean || clean.toLowerCase() === 'n/a' || clean.toLowerCase() === 'none') return clean;
    
    // Already correct DD/MM/YYYY
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(clean)) return clean;
    
    // YYYY-MM-DD or YYYY/MM/DD
    if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(clean)) {
        const parts = clean.split(/[-/]/);
        return `${parts[2].padStart(2, '0')}/${parts[1].padStart(2, '0')}/${parts[0]}`;
    }
    
    // DD-MM-YYYY or DD/MM/YYYY or D/M/YYYY or D-M-YYYY
    if (/^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/.test(clean)) {
        const parts = clean.split(/[-/]/);
        let year = parts[2];
        // Handle two-digit years (assuming > 30 is 19XX, else 20XX for birth dates)
        if (year.length === 2) {
            year = parseInt(year) > 30 ? `19${year}` : `20${year}`;
        }
        return `${parts[0].padStart(2, '0')}/${parts[1].padStart(2, '0')}/${year}`;
    }
    
    // Fallback native Date parsing (risky with US vs EU formats, but better than nothing)
    // Only attempt if it has words like "Jan", "Feb" etc
    if (/[a-zA-Z]/.test(clean)) {
        const d = new Date(clean);
        if (!isNaN(d.getTime())) {
            return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth()+1).padStart(2, '0')}/${d.getFullYear()}`;
        }
    }
    
    return clean;
}

async function run() {
    try {
        console.log("Fetching all candidates from Redis...");
        
        let cursor = '0';
        let candidateKeys = [];
        do {
            const result = await redis.scan(cursor, 'MATCH', 'candidate:*', 'COUNT', 1000);
            cursor = result[0];
            candidateKeys.push(...result[1]);
        } while (cursor !== '0');
        
        console.log(`Found ${candidateKeys.length} candidate keys.`);
        
        let updatedCount = 0;
        
        for (const key of candidateKeys) {
            const rawData = await redis.get(key);
            if (!rawData) continue;
            
            try {
                const candidate = JSON.parse(rawData);
                const oldDate = candidate.fechaNacimiento;
                
                if (oldDate) {
                    const newDate = normalizeDate(oldDate);
                    
                    if (oldDate !== newDate) {
                        console.log(`Normalizing ID ${candidate.id}: "${oldDate}" -> "${newDate}"`);
                        candidate.fechaNacimiento = newDate;
                        await redis.set(key, JSON.stringify(candidate));
                        updatedCount++;
                    }
                }
            } catch (err) {
                console.error(`Error parsing JSON for ${key}`);
            }
        }
        
        // Also check the global 'candidates' array index if it exists
        const rawGlobal = await redis.get('candidates');
        if (rawGlobal) {
            let globalUpdated = false;
            const globalCandidates = JSON.parse(rawGlobal);
            for (const candidate of globalCandidates) {
                const oldDate = candidate.fechaNacimiento;
                if (oldDate) {
                    const newDate = normalizeDate(oldDate);
                    if (oldDate !== newDate) {
                        candidate.fechaNacimiento = newDate;
                        globalUpdated = true;
                    }
                }
            }
            if (globalUpdated) {
                console.log("Updating global 'candidates' index...");
                await redis.set('candidates', JSON.stringify(globalCandidates));
            }
        }
        
        console.log(`\n================================`);
        console.log(`Normalization complete.`);
        console.log(`Dates normalized: ${updatedCount}`);
        console.log(`================================\n`);
        
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

run();
