import { getRedisClient, validateAdminSession } from '../utils/storage.js';
import { normalizeForMatch } from '../utils/colonia-normalizer.js';

// Detect and fix mojibake: UTF-8 text that was mis-read as Latin-1 then re-encoded.
// Indicator: 'Ã' followed by a char in range 0x80-0xBF (like 'Ã¡' for á).
const hasMojibake = (str) => /Ã[\x80-\xBF]/.test(str);

const fixMojibake = (str) => {
    if (!hasMojibake(str)) return str;
    try {
        const bytes = Buffer.allocUnsafe(str.length);
        for (let i = 0; i < str.length; i++) {
            bytes[i] = str.charCodeAt(i) & 0xFF;
        }
        return bytes.toString('utf-8');
    } catch {
        return str;
    }
};

const normalizeMuniKey = (m) =>
    m.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

    const userId = await validateAdminSession(req);
    if (!userId) return res.status(403).json({ error: 'Forbidden' });

    const redis = getRedisClient();
    if (!redis) return res.status(503).json({ error: 'Redis unavailable' });

    try {
        const csvText = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

        // Fix mojibake encoding (UTF-8 read as Latin-1)
        const fixed = fixMojibake(csvText);

        const lines = fixed.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length < 2) return res.status(400).json({ error: 'CSV vacío' });

        // Strip BOM if present
        const headerLine = lines[0].replace(/^﻿/, '');
        const headers = headerLine.split(',').map(h => h.trim().toLowerCase());

        const iMunicipio = headers.indexOf('municipio');
        const iColonia = headers.indexOf('colonia');
        const iCp = headers.indexOf('cp');

        if (iMunicipio < 0 || iColonia < 0) {
            return res.status(400).json({ error: 'CSV debe tener columnas municipio y colonia' });
        }

        // Parse and group by municipio
        const byMunicipio = new Map();

        for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(',');
            const municipio = cols[iMunicipio]?.trim();
            const colonia = cols[iColonia]?.trim();
            const cp = iCp >= 0 ? cols[iCp]?.trim() : undefined;

            if (!municipio || !colonia) continue;

            const key = normalizeMuniKey(municipio);
            if (!byMunicipio.has(key)) byMunicipio.set(key, []);

            const nameNorm = normalizeForMatch(colonia);
            if (!nameNorm) continue;

            // Deduplicate by normalized name
            const list = byMunicipio.get(key);
            if (!list.some(c => c.nameNorm === nameNorm)) {
                list.push({ name: colonia, nameNorm, cp: cp || undefined });
            }
        }

        if (byMunicipio.size === 0) {
            return res.status(400).json({ error: 'No se encontraron datos válidos' });
        }

        // Store each municipio's colonia list in Redis
        const pipeline = redis.pipeline();
        for (const [key, list] of byMunicipio) {
            pipeline.set(`colonia_dir:${key}`, JSON.stringify(list));
        }
        // Store index of available municipios
        pipeline.set('colonia_dir:_index', JSON.stringify([...byMunicipio.keys()]));
        await pipeline.exec();

        const totalColonias = [...byMunicipio.values()].reduce((s, a) => s + a.length, 0);
        return res.status(200).json({
            ok: true,
            municipios: byMunicipio.size,
            colonias: totalColonias,
        });
    } catch (err) {
        console.error('[seed-colonias]', err);
        return res.status(500).json({ error: err.message });
    }
}

export const config = { api: { bodyParser: { sizeLimit: '8mb' } } };
