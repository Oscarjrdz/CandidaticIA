/**
 * Migración: Convierte colonias/fraccionamientos de NL al municipio oficial al que pertenecen.
 * También corrige errores ortográficos de municipios de NL.
 *
 * Solo toca candidatos cuyo municipio coincide exactamente (normalizado) con una entrada del mapa.
 * Los municipios de otros estados se dejan intactos.
 *
 * Uso:         node scripts/migrate-colonias-a-municipios.js
 * Dry run:     DRY_RUN=true node scripts/migrate-colonias-a-municipios.js
 */

import Redis from 'ioredis';
import fs from 'fs';
import path from 'path';

// ── ENV ──────────────────────────────────────────────────────────────────────
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

if (!process.env.REDIS_URL) { console.error('❌ NO REDIS_URL'); process.exit(1); }

const DRY_RUN = process.env.DRY_RUN === 'true';
if (DRY_RUN) console.log('🔍 DRY RUN — sin cambios reales.\n');

// ── NORMALIZACIÓN ─────────────────────────────────────────────────────────────
const normalize = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

// ── MAPA: colonia/fraccionamiento → municipio oficial de NL ───────────────────
// Fuentes: SEPOMEX, codigo-postal.co, marketdatamexico.com, congreso NL
const COLONIAS_MAP = new Map(Object.entries({

    // ── APODACA ──────────────────────────────────────────────────────────────
    'pueblo nuevo': 'Apodaca',           // Colonia más poblada de Latinoamérica, Apodaca
    'treboles': 'Apodaca',               // Fracc. Tréboles, Apodaca
    'tréboles': 'Apodaca',

    // ── MONTERREY ────────────────────────────────────────────────────────────
    'san bernabe': 'Monterrey',          // Sector San Bernabé, múltiples secciones
    'colonia independencia': 'Monterrey',
    'independencia': 'Monterrey',        // Col. Independencia histórica
    'estanzuela': 'Monterrey',           // La Estanzuela, cp 64988
    'moderna': 'Monterrey',              // Col. Moderna, cp 64530
    'valle de infonavit': 'Monterrey',   // Unidad Hab. Valle del Infonavit
    'valle del infonavit': 'Monterrey',
    'santa lucia': 'Monterrey',          // Valle de Santa Lucía / Granja Sanitaria
    'valle de santa lucia': 'Monterrey',
    'santa isabel': 'Monterrey',         // Col. Santa Isabel, cp 64102
    'hilario martinez': 'Monterrey',     // Col. Nuevo Repueblo / Hilario Martínez
    'seminario': 'Monterrey',            // Col. Seminario / Bosques del Seminario
    'rosales': 'Monterrey',              // Col. Los Rosales, cp 64764
    'aztlan': 'Monterrey',               // Barrio Aztlán
    'azuatlan': 'Monterrey',             // probable variante de Aztlán
    'mty': 'Monterrey',                  // abreviación

    // ── GUADALUPE ────────────────────────────────────────────────────────────
    'dos rios': 'Guadalupe',             // Fracc. Dos Ríos, cp 67134
    'huerta': 'Guadalupe',               // Col. La Huerta, cp 67144

    // ── GENERAL ZUAZUA ───────────────────────────────────────────────────────
    'real de palmas': 'General Zuazua',  // Fracc. Real de Palmas, cp 65760
    'valle de santa elena': 'General Zuazua', // Fracc. Valle de Santa Elena, cp 65776

    // ── EL CARMEN ────────────────────────────────────────────────────────────
    'buena vista': 'El Carmen',          // Fracc. Buena Vista, El Carmen (~30k hab.)
    'buenavista': 'El Carmen',
    'jaral': 'El Carmen',                // Col. El Jaral, cp 66580
    'el jaral': 'El Carmen',
    'valle del jaral': 'El Carmen',      // Fracc. Valle del Jaral, cp 66580
    'valles de jaral': 'El Carmen',
    'vallés de jaral': 'El Carmen',
    'villas del arco': 'El Carmen',      // Fracc. Villas del Arco, cp 66550
    'villa del arco': 'El Carmen',

    // ── PESQUERÍA ─────────────────────────────────────────────────────────────
    'valle de santa maria': 'Pesquería', // Fracc. Valle de Santa María, cp 66670
    'valle de santa maria peskeria': 'Pesquería',
    'colinas del aeropuerto': 'Pesquería', // cp 66655 (no Apodaca)
    'peskeria': 'Pesquería',             // error ortográfico

    // ── GARCÍA ───────────────────────────────────────────────────────────────
    'valle de lincoln': 'García',        // Fracc. Valle de Lincoln, cp 66026
    'valles de lincoln': 'García',
    'ciudad de lincoln': 'García',
    'garsia valle de lincon': 'García',  // error ortográfico
    'heroes de capellania': 'García',    // Fracc. Héroes de Capellanía (desarrollo SADASI)
    'héroes de capellanía': 'García',

    // ── BENITO JUÁREZ ─────────────────────────────────────────────────────────
    'santa monica': 'Benito Juárez',     // Fracc. Santa Mónica, cp 67286
    'valle de santa isabel': 'Benito Juárez', // Col. Valle de Santa Isabel, cp 67256

    // ── SALINAS VICTORIA ─────────────────────────────────────────────────────
    'joya de castilla': 'Salinas Victoria', // Fracc. Joya de Castilla, cp 65516

    // ── GENERAL ESCOBEDO ─────────────────────────────────────────────────────
    'solidaridad': 'General Escobedo',   // Col. Solidaridad, cp 66058

    // ── SAN NICOLÁS DE LOS GARZA ─────────────────────────────────────────────
    'sanicolas': 'San Nicolás de los Garza', // error ortográfico

    // ── CORRECCIONES ORTOGRÁFICAS DE MUNICIPIOS ───────────────────────────────
    'cienaga de flores': 'Ciénega de Flores',  // tilde/vocal equivocada
    'ciénaga de flores': 'Ciénega de Flores',
    'sienega de flores': 'Ciénega de Flores',
    'cienaga': 'Ciénega de Flores',
    'ciénaga': 'Ciénega de Flores',
}));

function resolveColonia(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const key = normalize(raw);
    return COLONIAS_MAP.get(key) || null;
}

// ── REDIS ──────────────────────────────────────────────────────────────────────
const redis = new Redis(process.env.REDIS_URL, {
    tls: process.env.REDIS_URL.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
});

// ── MIGRACIÓN ──────────────────────────────────────────────────────────────────
async function migrate() {
    await redis.ping();
    console.log('✅ Conectado a Redis.\n');

    const total = await redis.zcard('candidates:list');
    console.log(`📊 Total candidatos: ${total}\n`);

    const CHUNK = 500;
    let offset = 0;
    let updated = 0;
    let skipped = 0;
    const changes = [];

    while (offset < total) {
        const ids = await redis.zrevrange('candidates:list', offset, offset + CHUNK - 1);
        if (!ids.length) break;

        const pipeline = redis.pipeline();
        ids.forEach(id => pipeline.get('candidate:' + id));
        const results = await pipeline.exec();

        for (let i = 0; i < ids.length; i++) {
            const [err, raw] = results[i];
            if (err || !raw) continue;

            let candidate;
            try { candidate = JSON.parse(raw); } catch { continue; }

            const current = candidate.municipio;
            if (!current) { skipped++; continue; }

            const official = resolveColonia(current);
            if (!official) { skipped++; continue; }
            if (current === official) { skipped++; continue; }

            changes.push({ id: ids[i], before: current, after: official });
            candidate.municipio = official;

            if (!DRY_RUN) {
                await redis.set('candidate:' + ids[i], JSON.stringify(candidate));
            }
            updated++;
        }

        offset += CHUNK;
        await new Promise(r => setTimeout(r, 5));
    }

    // ── RESUMEN ──────────────────────────────────────────────────────────────
    console.log('══════════════════════════════════════════');
    console.log(`✅ MIGRACIÓN ${DRY_RUN ? '(DRY RUN)' : 'COMPLETADA'}`);
    console.log('══════════════════════════════════════════');
    console.log(`  Actualizados : ${updated}`);
    console.log(`  Sin cambio   : ${skipped}`);
    console.log('══════════════════════════════════════════\n');

    if (changes.length > 0) {
        console.log('📋 Cambios:');
        const grouped = {};
        for (const c of changes) {
            const key = '"' + c.before + '" → "' + c.after + '"';
            grouped[key] = (grouped[key] || 0) + 1;
        }
        for (const [change, count] of Object.entries(grouped).sort((a, b) => b[1] - a[1])) {
            console.log('  ' + count.toString().padStart(4) + 'x  ' + change);
        }
    }

    redis.disconnect();
}

migrate().catch(e => { console.error('❌ Fatal:', e); redis.disconnect(); process.exit(1); });
