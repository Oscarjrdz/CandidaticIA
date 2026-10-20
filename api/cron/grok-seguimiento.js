/**
 * /api/cron/grok-seguimiento
 * Vercel Cron — corre cada 15 min.
 *
 * Evento "candidato inactivo 1h": busca candidatos con registro INCOMPLETO que llevan
 * ~1 hora sin responder y le manda a Grok (xAI) el evento con TODO el contexto pre-cargado
 * para que Grok decida qué hacer (mandar WhatsApp / meter a un flow / etiquetar / nada).
 *
 * TODO el gasto está gateado:
 *   - Apagado por default (grok:seguimiento:settings.enabled !== true).
 *   - Requiere env XAI_API_KEY (sin ella, no-op).
 *   - Requiere el MCP encendido (mcp:enabled) — sin él, las tools de Grok fallarían.
 *   - Gate 100% en Redis ANTES de gastar un token: incompleto + 1h de silencio + no modo
 *     humano + debounce por candidato + tope de edad (sale del funnel tras maxSilenceDays).
 *   - Lock idempotente + presupuesto de tiempo por corrida (no rebasa el maxDuration).
 */

import { getRedisClient, getCandidateById, updateCandidate } from '../utils/storage.js';
import { acquireProcessingLock, releaseProcessingLock } from '../utils/reminder-lock.js';
import { getMissingFields } from '../reengagement-queue.js';
import { buildInactivityPayload, sendInactivityEventToGrok, recordFollowup } from '../utils/grok-event.js';

const SETTINGS_KEY = 'grok:seguimiento:settings';

// Defaults (editables en grok:seguimiento:settings):
const DEFAULTS = {
    enabled: false,
    model: 'grok-4.3',
    inactivityMinutes: 60,   // "1 hora sin responder"
    debounceMinutes: 55,     // no re-analizar al mismo candidato antes de esto → cadencia ~horaria
    maxSilenceDays: 7,       // tras esto sale del funnel (no quemar tokens en candidato muerto)
    maxPerRun: 10,           // tope de candidatos por corrida
    timeBudgetMs: 90000      // deja de arrancar llamadas a Grok pasado esto (protege maxDuration)
};

export default async function handler(req, res) {
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'Redis unavailable' });

    // ── Settings + gates globales ──────────────────────────────────────────────
    let settings = {};
    try { const raw = await redis.get(SETTINGS_KEY); settings = raw ? JSON.parse(raw) : {}; } catch { /* usa defaults */ }
    const cfg = { ...DEFAULTS, ...settings };

    const forceCandidateId = req.body?.forceCandidateId || null;

    if (!cfg.enabled && !forceCandidateId) {
        return res.json({ success: true, skipped: 'disabled', processed: 0 });
    }
    if (!process.env.XAI_API_KEY) {
        return res.json({ success: true, skipped: 'no_xai_api_key', processed: 0 });
    }
    const [mcpToken, mcpEnabledRaw] = await Promise.all([redis.get('mcp:token'), redis.get('mcp:enabled')]);
    const mcpEnabled = mcpEnabledRaw === '1' || mcpEnabledRaw === 'true';
    if (!mcpToken || !mcpEnabled) {
        return res.json({ success: true, skipped: 'mcp_off', processed: 0 });
    }
    const mcpUrl = process.env.MCP_PUBLIC_URL || `https://${req.headers.host}/api/mcp`;

    const now = Date.now();
    const inactivityMs = cfg.inactivityMinutes * 60000;
    const debounceMs = cfg.debounceMinutes * 60000;
    const maxSilenceMs = cfg.maxSilenceDays * 86400000;

    // ── Cargar candidatos pendientes (índice, no escaneo) ───────────────────────
    let candidates = [];
    try {
        if (forceCandidateId) {
            const c = await getCandidateById(forceCandidateId);
            candidates = c ? [c] : [];
        } else {
            const pendingIds = await redis.srandmember('stats:list:pending', 500);
            if (pendingIds?.length) {
                const pipe = redis.pipeline();
                pendingIds.forEach(id => pipe.get(`candidate:${id}`));
                const results = await pipe.exec();
                candidates = results
                    .map(([, raw]) => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } })
                    .filter(Boolean);
            }
        }
    } catch {
        return res.status(500).json({ error: 'Cannot fetch candidates' });
    }

    let sent = 0, skipped = 0, errors = 0, agedOut = 0;
    const log = [];

    for (const candidate of candidates) {
        if (sent >= cfg.maxPerRun) break;
        if (Date.now() - now > cfg.timeBudgetMs) break; // presupuesto de tiempo agotado

        let lock = null;
        try {
            // ── Gate barato (solo Redis, cero tokens) ───────────────────────────
            // Objetivo = INCOMPLETOS. Perfil completo (paso1 sin faltantes Y paso2 completo)
            // no es candidato a seguimiento.
            if (getMissingFields(candidate).length === 0 && candidate.paso2Estado === 'completo') { skipped++; continue; }
            if (candidate.blocked) { skipped++; continue; }         // humano tomó el chat

            const lastMsgTs = candidate.lastUserMessageAt ? new Date(candidate.lastUserMessageAt).getTime() : 0;
            const silence = now - (lastMsgTs || now);

            if (!forceCandidateId) {
                if (!lastMsgTs) { skipped++; continue; }
                if (silence < inactivityMs) { skipped++; continue; }   // aún no cumple 1h
                if (silence > maxSilenceMs) { agedOut++; skipped++; continue; } // ya muerto
                const lastGrokTs = candidate.grok_followup_last ? new Date(candidate.grok_followup_last).getTime() : 0;
                if (lastGrokTs && (now - lastGrokTs) < debounceMs) { skipped++; continue; } // ya se analizó hace poco
            }

            // Lock solo cuando ya decidimos gastar (evita SET/DEL masivos por corrida)
            lock = await acquireProcessingLock(redis, 'grok_followup', candidate.id);
            if (!lock) { skipped++; continue; }

            // ── Construir payload y mandar a Grok ────────────────────────────────
            const payload = await buildInactivityPayload({ candidate, redis });
            const result = await sendInactivityEventToGrok({
                payload,
                candidateId: candidate.id,
                mcpUrl,
                mcpToken,
                model: cfg.model
            });

            if (!result.ok) {
                console.error(`[GROK-SEGUIMIENTO] ❌ ${candidate.id}: ${result.error}`);
                errors++;
                continue;
            }

            // Marca de debounce ANTES de la bitácora: si algo falla, no re-dispara en 15 min
            await updateCandidate(candidate.id, {
                grok_followup_last: new Date().toISOString(),
                grok_followup_attempts: (Number(candidate.grok_followup_attempts) || 0) + 1
            });
            await recordFollowup(redis, candidate.id, { resumen: result.resumen });

            const toks = result.usage
                ? ` [in:${result.usage.input_tokens ?? result.usage.prompt_tokens ?? '?'} cached:${result.usage.input_tokens_details?.cached_tokens ?? '?'} out:${result.usage.output_tokens ?? result.usage.completion_tokens ?? '?'}]`
                : '';
            console.log(`[GROK-SEGUIMIENTO] ✅ ${candidate.id}: ${result.resumen}${toks}`);
            log.push({ candidateId: candidate.id, resumen: result.resumen });
            sent++;
        } catch (e) {
            console.error(`[GROK-SEGUIMIENTO] ❌ Error con ${candidate.id}:`, e.message);
            errors++;
        } finally {
            if (lock) await releaseProcessingLock(redis, lock);
        }
    }

    return res.json({
        success: true,
        processed: sent + skipped + errors,
        sent, skipped, errors, agedOut,
        log,
        timestamp: new Date().toISOString()
    });
}
