/**
 * AGENT LIVE FEED — narración del motor de Agent Candidatic hacia el chat del agente.
 *
 * Cuando el motor atiende (o no sabe qué hacer con) un candidato de la cola en vivo,
 * publica una entrada aquí. AgentChat.jsx la sondea y la muestra como una burbuja del
 * sistema en el chat — así el reclutador se entera SIN tener que preguntar, y si el
 * motor tuvo una duda, aparece ahí mismo para que el reclutador la resuelva.
 *
 * candidatic:agent_live_feed = JSON [{ id, ts, kind, text, candidateId, candidateName, tag }]
 * kind: 'action' (hizo algo) | 'question' (no supo qué hacer, pregunta) | 'error'
 */
import { getRedisClient } from './storage.js';

const KEY_FEED = 'candidatic:agent_live_feed';
const FEED_CAP = 200;

export async function getLiveFeed() {
    const redis = getRedisClient();
    if (!redis) return [];
    try {
        const raw = await redis.get(KEY_FEED);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
}

export async function pushLiveFeed({ kind, text, candidateId, candidateName, tag }) {
    const redis = getRedisClient();
    if (!redis) return null;
    try {
        const feed = await getLiveFeed();
        const entry = {
            id: `feed_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            ts: new Date().toISOString(),
            kind: kind || 'action',
            text: String(text || '').trim(),
            candidateId: candidateId || null,
            candidateName: candidateName || null,
            tag: tag || null
        };
        const next = [...feed, entry].slice(-FEED_CAP);
        await redis.set(KEY_FEED, JSON.stringify(next));
        return entry;
    } catch (e) {
        console.error('[AGENT-LIVE-FEED] pushLiveFeed:', e?.message);
        return null;
    }
}
