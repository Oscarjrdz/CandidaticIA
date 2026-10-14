/**
 * flows-data.js — helpers de datos que usa el sistema de Flows (constructor visual
 * de automatizaciones): catálogo de vacantes del bot y contadores de altas por día.
 *
 * Origen histórico: estas funciones vivían en `api/utils/agent-ia.js`, que se eliminó
 * (ver docs/eliminacion-seccion-agent-ia.md). Flows (api/flows.js) y el motor de flujos
 * (api/utils/flow-engine.js) las seguían usando, así que se extrajeron aquí a un hogar
 * neutral — son utilidades de plataforma, no tienen nada que ver con el agente removido.
 */
import { getRedisClient } from './storage.js';

// ─── Vacantes del bot ────────────────────────────────────────────────────────

export async function getBotVacancies() {
    const redis = getRedisClient();
    if (!redis) return [];
    try {
        const raw = await redis.get('candidatic_vacancies');
        const list = raw ? JSON.parse(raw) : [];
        return (Array.isArray(list) ? list : []).filter((v) => v && v.active && v.messageDescription);
    } catch {
        return [];
    }
}

// Texto enviable de una vacante (igual que el chat manual).
export function vacancyMessageText(v) {
    return `*${v.name}*\n\n${v.messageDescription}`;
}

// ─── Altas por fecha (contadores diarios, zona Monterrey) ────────────────────
// Todo es HMGET de hashes que la plataforma ya mantiene: barato, sin escanear.
const mtyDateKey = (d) => d.toLocaleDateString('sv-SE', { timeZone: 'America/Monterrey' });

// Traduce un rango ('hoy'/'ayer'/'semana'/'mes') o un rango explícito (desde/hasta,
// YYYY-MM-DD) a la lista de llaves de día. Devuelve {keys, label}.
export function buildDateKeys({ rango, desde, hasta } = {}) {
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    if ((desde && iso.test(desde)) || (hasta && iso.test(hasta))) {
        const start = iso.test(desde) ? desde : hasta;
        const end = iso.test(hasta) ? hasta : start;
        const lo = start <= end ? start : end;
        const hi = start <= end ? end : start;
        const keys = [];
        let cur = new Date(`${lo}T12:00:00Z`);
        const stop = new Date(`${hi}T12:00:00Z`);
        let guard = 0;
        while (cur <= stop && guard < 92) {
            keys.push(cur.toISOString().slice(0, 10));
            cur = new Date(cur.getTime() + 86400000);
            guard++;
        }
        return { keys, label: `del ${lo} al ${hi}` };
    }
    const now = new Date();
    const today = mtyDateKey(now);
    const shift = (n) => mtyDateKey(new Date(now.getTime() + n * 86400000));
    switch (rango) {
        case 'ayer': {
            const y = shift(-1);
            return { keys: [y], label: `ayer (${y})` };
        }
        case 'semana': {
            const keys = [];
            for (let i = 6; i >= 0; i--) keys.push(shift(-i));
            return { keys: [...new Set(keys)], label: 'los últimos 7 días' };
        }
        case 'mes': {
            const [y, m] = today.split('-');
            const day = parseInt(today.slice(8), 10) || 1;
            const keys = [];
            for (let d = 1; d <= day; d++) keys.push(`${y}-${m}-${String(d).padStart(2, '0')}`);
            return { keys, label: `este mes (${y}-${m})` };
        }
        default:
            return { keys: [today], label: `hoy (${today})` };
    }
}

// Total de altas (todos los candidatos) en esas fechas.
export async function getCapturesTotal(dateKeys) {
    const redis = getRedisClient();
    if (!redis || !dateKeys?.length) return 0;
    try {
        const vals = await redis.hmget('stats:daily:captures', ...dateKeys);
        return (vals || []).reduce((s, v) => s + (parseInt(v, 10) || 0), 0);
    } catch {
        return 0;
    }
}

// Nombres de etiquetas definidas + sus contadores vivos (candidatic:chat_tags +
// candidatic:tag_counts). Dependencia interna de getCapturesByAllTags.
async function getTagCounts() {
    const redis = getRedisClient();
    if (!redis) return null;
    try {
        const [rawTags, rawCounts, rawUntagged] = await Promise.all([
            redis.get('candidatic:chat_tags'),
            redis.hgetall('candidatic:tag_counts'),
            redis.get('candidatic:untagged_count')
        ]);
        let defined = [];
        try {
            const l = rawTags ? JSON.parse(rawTags) : [];
            defined = (Array.isArray(l) ? l : [])
                .map((t) => (typeof t === 'string' ? t : t?.name))
                .map((n) => String(n || '').trim())
                .filter(Boolean);
        } catch { /* ignorar json malo */ }
        const countMap = rawCounts || {};
        const names = new Set(defined);
        Object.keys(countMap).forEach((k) => { if (k) names.add(k); });
        const tags = [...names]
            .map((name) => ({ name, count: parseInt(countMap[name], 10) || 0 }))
            .sort((a, b) => b.count - a.count);
        const untagged = Math.max(0, parseInt(rawUntagged, 10) || 0);
        return { tags, untagged };
    } catch {
        return null;
    }
}

// Desglose de altas por TODAS las etiquetas en esas fechas, en una sola pasada
// (un pipeline, no N llamadas). Usa los nombres definidos que ya expone
// getTagCounts (candidatic:chat_tags + contadores vivos) — así que también salen
// etiquetas con 0 altas en el rango.
export async function getCapturesByAllTags(dateKeys) {
    const redis = getRedisClient();
    if (!redis || !dateKeys?.length) return [];
    const data = await getTagCounts();
    const names = (data?.tags || []).map((t) => t.name);
    if (!names.length) return [];
    try {
        const pipeline = redis.pipeline();
        names.forEach((name) => pipeline.hmget(`stats:daily:captures:tag:${name}`, ...dateKeys));
        const results = await pipeline.exec();
        return names
            .map((name, i) => {
                const vals = results[i]?.[1] || [];
                const total = vals.reduce((s, v) => s + (parseInt(v, 10) || 0), 0);
                return { name, total };
            })
            .sort((a, b) => b.total - a.total);
    } catch {
        return [];
    }
}
