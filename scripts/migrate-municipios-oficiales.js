/**
 * Migración: Normaliza municipios de candidatos a nombres oficiales de Nuevo León.
 *
 * - Lee todos los candidatos de Redis.
 * - Mapea nombres cortos/variantes al nombre oficial completo.
 * - Solo actualiza si el valor cambia (no toca los que ya están bien).
 * - No borra ni duplica candidatos.
 *
 * Uso: node scripts/migrate-municipios-oficiales.js
 * Para dry-run sin guardar: DRY_RUN=true node scripts/migrate-municipios-oficiales.js
 */

import Redis from 'ioredis';
import fs from 'fs';
import path from 'path';

// ── 1. ENV ─────────────────────────────────────────────────────────────────
const loadEnv = () => {
    try {
        const envPath = path.resolve(process.cwd(), '.env.local');
        if (fs.existsSync(envPath)) {
            console.log('📄 Found .env.local');
            const envConfig = fs.readFileSync(envPath, 'utf8');
            envConfig.split('\n').forEach(line => {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) return;
                const eqIndex = trimmed.indexOf('=');
                if (eqIndex === -1) return;
                const key = trimmed.slice(0, eqIndex).trim();
                let val = trimmed.slice(eqIndex + 1).trim();
                // Strip surrounding quotes if present
                if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                    val = val.slice(1, -1);
                }
                if (key && val) process.env[key] = val;
            });
            if (!process.env.REDIS_URL && process.env.UPSTASH_REDIS_REST_URL) {
                process.env.REDIS_URL = process.env.UPSTASH_REDIS_REST_URL.replace('https://', 'rediss://');
            }
        }
    } catch (e) {
        console.error('Error loading env:', e);
    }
};

loadEnv();

if (!process.env.REDIS_URL) {
    console.error('❌ NO REDIS_URL FOUND. Cannot proceed.');
    process.exit(1);
}

const DRY_RUN = process.env.DRY_RUN === 'true';
if (DRY_RUN) console.log('🔍 DRY RUN MODE — no changes will be saved.\n');

// ── 2. MAPA DE NORMALIZACIÓN ────────────────────────────────────────────────
// Clave: versión normalizada (minúsculas, sin tildes)
// Valor: nombre oficial del municipio de Nuevo León
const normalize = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

const NORMALIZATION_MAP = new Map(Object.entries({
    // Área metropolitana — nombres que cambian
    'escobedo': 'General Escobedo',
    'gral escobedo': 'General Escobedo',
    'general mariano escobedo': 'General Escobedo',
    'san nicolas': 'San Nicolás de los Garza',
    'san nico': 'San Nicolás de los Garza',
    'sn nicolas': 'San Nicolás de los Garza',
    'san pedro': 'San Pedro Garza García',
    'spgg': 'San Pedro Garza García',
    'juarez': 'Benito Juárez',
    'cd juarez': 'Benito Juárez',
    'ciudad juarez': 'Benito Juárez',
    'zuazua': 'General Zuazua',
    'gral zuazua': 'General Zuazua',
    // Nombres cortos → oficiales
    'cadereyta': 'Cadereyta Jiménez',
    'cadereyta garibaldi': 'Cadereyta Jiménez',
    'carmen': 'El Carmen',
    'cienega': 'Ciénega de Flores',
    'aldama': 'Los Aldamas',
    'los aldamas': 'Los Aldamas',
    'herreras': 'Los Herreras',
    'los herreras': 'Los Herreras',
    'ramones': 'Los Ramones',
    'los ramones': 'Los Ramones',
    'lampazos': 'Lampazos de Naranjo',
    'sabinas': 'Sabinas Hidalgo',
    'salinas': 'Salinas Victoria',
    // Nombres que ya son correctos (para confirmar sin cambio)
    'general escobedo': 'General Escobedo',
    'san nicolas de los garza': 'San Nicolás de los Garza',
    'san pedro garza garcia': 'San Pedro Garza García',
    'benito juarez': 'Benito Juárez',
    'general zuazua': 'General Zuazua',
    'cadereyta jimenez': 'Cadereyta Jiménez',
    'el carmen': 'El Carmen',
    'cienega de flores': 'Ciénega de Flores',
    'lampazos de naranjo': 'Lampazos de Naranjo',
    'sabinas hidalgo': 'Sabinas Hidalgo',
    'salinas victoria': 'Salinas Victoria',
    // Municipios que no cambian (nombre corto = nombre oficial)
    'monterrey': 'Monterrey',
    'guadalupe': 'Guadalupe',
    'apodaca': 'Apodaca',
    'santa catarina': 'Santa Catarina',
    'garcia': 'García',
    'pesqueria': 'Pesquería',
    'santiago': 'Santiago',
    'abasolo': 'Abasolo',
    'agualeguas': 'Agualeguas',
    'allende': 'Allende',
    'anahuac': 'Anáhuac',
    'aramberri': 'Aramberri',
    'bustamante': 'Bustamante',
    'cerralvo': 'Cerralvo',
    'china': 'China',
    'doctor arroyo': 'Doctor Arroyo',
    'doctor coss': 'Doctor Coss',
    'doctor gonzalez': 'Doctor González',
    'galeana': 'Galeana',
    'general bravo': 'General Bravo',
    'general teran': 'General Terán',
    'general trevino': 'General Treviño',
    'general zaragoza': 'General Zaragoza',
    'higueras': 'Higueras',
    'hualahuises': 'Hualahuises',
    'iturbide': 'Iturbide',
    'linares': 'Linares',
    'marin': 'Marín',
    'melchor ocampo': 'Melchor Ocampo',
    'mier y noriega': 'Mier y Noriega',
    'mina': 'Mina',
    'montemorelos': 'Montemorelos',
    'paras': 'Parás',
    'rayones': 'Rayones',
    'hidalgo': 'Hidalgo',
    'vallecillo': 'Vallecillo',
    'villaldama': 'Villaldama',
}));

function resolveOfficialName(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const key = normalize(raw);
    if (NORMALIZATION_MAP.has(key)) return NORMALIZATION_MAP.get(key);
    // Búsqueda parcial para cosas como "escobedo nl" o "gral escobedo nl"
    for (const [k, v] of NORMALIZATION_MAP.entries()) {
        if (key.includes(k) && k.length > 4) return v;
    }
    return null; // Municipio desconocido — no tocar
}

// ── 3. REDIS ────────────────────────────────────────────────────────────────
const redis = new Redis(process.env.REDIS_URL, {
    tls: process.env.REDIS_URL.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
});
redis.on('error', (err) => console.error('❌ Redis error:', err.message));

// ── 4. MIGRACIÓN ────────────────────────────────────────────────────────────
async function migrate() {
    console.log('🚀 Conectando a Redis...');
    await redis.ping();
    console.log('✅ Conectado.\n');

    // Obtener total
    const total = await redis.zcard('candidates:list');
    console.log(`📊 Total candidatos en la base: ${total}\n`);

    const CHUNK = 500;
    let offset = 0;
    let processed = 0;
    let updated = 0;
    let already_ok = 0;
    let skipped_no_municipio = 0;
    let skipped_unknown = 0;
    let errors = 0;

    const changes = []; // log de cambios para revisión

    while (offset < total) {
        const ids = await redis.zrevrange('candidates:list', offset, offset + CHUNK - 1);
        if (ids.length === 0) break;

        const pipeline = redis.pipeline();
        ids.forEach(id => pipeline.get(`candidate:${id}`));
        const results = await pipeline.exec();

        for (let i = 0; i < ids.length; i++) {
            const id = ids[i];
            const [err, raw] = results[i];
            processed++;

            if (err || !raw) { errors++; continue; }

            let candidate;
            try { candidate = JSON.parse(raw); }
            catch { errors++; continue; }

            const currentMunicipioRaw = candidate.municipio;

            if (!currentMunicipioRaw) {
                skipped_no_municipio++;
                continue;
            }

            const officialName = resolveOfficialName(currentMunicipioRaw);

            if (!officialName) {
                // Municipio de otro estado u otro valor no reconocido — no tocar
                skipped_unknown++;
                continue;
            }

            if (currentMunicipioRaw === officialName) {
                already_ok++;
                continue;
            }

            // Necesita actualización
            changes.push({ id, before: currentMunicipioRaw, after: officialName });
            candidate.municipio = officialName;

            if (!DRY_RUN) {
                await redis.set(`candidate:${id}`, JSON.stringify(candidate));
            }
            updated++;
        }

        offset += CHUNK;
        // Yield event loop
        await new Promise(r => setTimeout(r, 5));

        if (offset % 1000 === 0 || offset >= total) {
            console.log(`  ⏳ Procesados: ${Math.min(offset, total)}/${total}`);
        }
    }

    // ── RESUMEN ──────────────────────────────────────────────────────────────
    console.log('\n══════════════════════════════════════════');
    console.log(`✅ MIGRACIÓN ${DRY_RUN ? '(DRY RUN)' : 'COMPLETADA'}`);
    console.log('══════════════════════════════════════════');
    console.log(`  Total procesados  : ${processed}`);
    console.log(`  Actualizados      : ${updated}`);
    console.log(`  Ya correctos      : ${already_ok}`);
    console.log(`  Sin municipio     : ${skipped_no_municipio}`);
    console.log(`  Municipio externo : ${skipped_unknown}`);
    console.log(`  Errores           : ${errors}`);
    console.log('══════════════════════════════════════════\n');

    if (changes.length > 0) {
        console.log('📋 Cambios realizados:');
        const grouped = {};
        for (const c of changes) {
            const key = `"${c.before}" → "${c.after}"`;
            grouped[key] = (grouped[key] || 0) + 1;
        }
        for (const [change, count] of Object.entries(grouped)) {
            console.log(`  ${count.toString().padStart(4, ' ')}x  ${change}`);
        }
    }

    redis.disconnect();
}

migrate().catch(e => {
    console.error('❌ Error fatal:', e);
    redis.disconnect();
    process.exit(1);
});
