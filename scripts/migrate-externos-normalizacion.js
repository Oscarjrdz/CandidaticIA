/**
 * Migración: Normaliza municipios de otros estados.
 * - Corrige abreviaciones, errores de acento y nombres alternos.
 * - Limpia basura (países, estados sin municipio, datos sin sentido → null).
 * - Los que ya tienen nombre oficial correcto no se tocan.
 *
 * Uso:      node scripts/migrate-externos-normalizacion.js
 * Dry run:  DRY_RUN=true node scripts/migrate-externos-normalizacion.js
 */

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

if (!process.env.REDIS_URL) { console.error('❌ NO REDIS_URL'); process.exit(1); }

const DRY_RUN = process.env.DRY_RUN === 'true';
if (DRY_RUN) console.log('🔍 DRY RUN — sin cambios reales.\n');

const normalize = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

// null = limpiar el campo (datos inválidos)
const NORMALIZE_MAP = new Map(Object.entries({

    // ── ABREVIACIONES ────────────────────────────────────────────────────────
    'cd mante':             'Ciudad Mante',          // Tamaulipas
    'heroica matamoros':    'Matamoros',              // nombre canónico

    // ── ERRORES DE ACENTO / CAPITALIZACIÓN ───────────────────────────────────
    'alvaro obregon':       'Álvaro Obregón',         // alcaldía CDMX
    'axtla de terrazas':    'Axtla de Terrazas',      // SLP (De → de)
    'san francisco del rincon': 'San Francisco del Rincón', // Guanajuato
    'toluca de lerdo':      'Toluca',                 // nombre corto oficial, Edomex

    // ── CAPITALIZACIÓN EXTRA EN NOMBRES COMPUESTOS ───────────────────────────
    'paraje san jose':      'Paraje San José',        // corregir acento

    // ── DATOS INVÁLIDOS — se limpian a null para que Brenda los vuelva a capturar
    'ubicacion':            null,   // "Ubicación" no es un municipio
    'brasil':               null,   // país
    'cundinamarca':         null,   // departamento de Colombia
    'sanajelzur':           null,   // cadena sin sentido
    'general':              null,   // incompleto ("General" a secas)
    'tetis':                null,   // no es municipio mexicano reconocido
    'nuevo leon':           null,   // solo dijo el estado, sin municipio
}));

const redis = new Redis(process.env.REDIS_URL, {
    tls: process.env.REDIS_URL.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
});

async function migrate() {
    await redis.ping();
    console.log('✅ Conectado.\n');

    const total = await redis.zcard('candidates:list');
    console.log(`📊 Total candidatos: ${total}\n`);

    const CHUNK = 500;
    let offset = 0;
    let updated = 0;
    let cleared = 0;
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
            if (!current) continue;

            const key = normalize(current);
            if (!NORMALIZE_MAP.has(key)) continue;

            const target = NORMALIZE_MAP.get(key); // puede ser null
            if (current === target) continue;

            changes.push({ id: ids[i], before: current, after: target ?? '(null)' });
            candidate.municipio = target ?? null;

            if (target === null) cleared++;
            else updated++;

            if (!DRY_RUN) {
                await redis.set('candidate:' + ids[i], JSON.stringify(candidate));
            }
        }

        offset += CHUNK;
        await new Promise(r => setTimeout(r, 5));
    }

    console.log('══════════════════════════════════════════');
    console.log(`✅ MIGRACIÓN ${DRY_RUN ? '(DRY RUN)' : 'COMPLETADA'}`);
    console.log('══════════════════════════════════════════');
    console.log(`  Corregidos  : ${updated}`);
    console.log(`  Limpiados   : ${cleared}  (datos inválidos → null)`);
    console.log('══════════════════════════════════════════\n');

    if (changes.length > 0) {
        console.log('📋 Cambios:');
        for (const c of changes) {
            console.log('  "' + c.before + '" → "' + c.after + '"');
        }
    }

    redis.disconnect();
}

migrate().catch(e => { console.error('❌ Fatal:', e); redis.disconnect(); process.exit(1); });
