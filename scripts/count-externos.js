import Redis from 'ioredis';
import fs from 'fs';
import path from 'path';

const envPath = path.resolve(process.cwd(), '.env.local');
const envConfig = fs.readFileSync(envPath, 'utf8');
envConfig.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) return;
    const key = trimmed.slice(0, eqIndex).trim();
    let val = trimmed.slice(eqIndex + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (key && val) process.env[key] = val;
});

const redis = new Redis(process.env.REDIS_URL, {
    tls: process.env.REDIS_URL.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
});

const normalize = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

const NL_OFICIALES = new Set([
    'Abasolo','Agualeguas','Los Aldamas','Allende','Anáhuac','Apodaca','Aramberri',
    'Benito Juárez','Bustamante','Cadereyta Jiménez','El Carmen','Cerralvo',
    'Ciénega de Flores','China','Doctor Arroyo','Doctor Coss','Doctor González',
    'Galeana','García','General Bravo','General Escobedo','General Terán',
    'General Treviño','General Zaragoza','General Zuazua','Guadalupe',
    'Los Herreras','Hidalgo','Higueras','Hualahuises','Iturbide',
    'Lampazos de Naranjo','Linares','Marín','Melchor Ocampo','Mier y Noriega',
    'Mina','Montemorelos','Monterrey','Parás','Pesquería','Los Ramones',
    'Rayones','Sabinas Hidalgo','Salinas Victoria','San Nicolás de los Garza',
    'San Pedro Garza García','Santa Catarina','Santiago','Vallecillo','Villaldama'
].map(normalize));

const total = await redis.zcard('candidates:list');
const CHUNK = 500;
let offset = 0;
const externos = {};

while (offset < total) {
    const ids = await redis.zrevrange('candidates:list', offset, offset + CHUNK - 1);
    if (!ids.length) break;
    const pipeline = redis.pipeline();
    ids.forEach(id => pipeline.get('candidate:' + id));
    const results = await pipeline.exec();
    for (const [err, raw] of results) {
        if (err || !raw) continue;
        try {
            const c = JSON.parse(raw);
            if (!c.municipio) continue;
            if (!NL_OFICIALES.has(normalize(c.municipio))) {
                externos[c.municipio] = (externos[c.municipio] || 0) + 1;
            }
        } catch {}
    }
    offset += CHUNK;
}

const sorted = Object.entries(externos).sort((a, b) => b[1] - a[1]);
const totalExternos = sorted.reduce((s, [, v]) => s + v, 0);

console.log('Total candidatos con municipio fuera de NL:', totalExternos);
console.log('Valores distintos:', sorted.length);
console.log('\nDetalle:');
for (const [mun, count] of sorted) {
    console.log('  ' + count.toString().padStart(4) + 'x  "' + mun + '"');
}

redis.disconnect();
