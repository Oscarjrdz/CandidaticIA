import { getRedisClient } from '../utils/storage.js';
import {
    BANK_NAME, BATCH_CAP,
    getToggleState, getPuntoKatconBank, cumpleCandados, sendPuntoKatconTo
} from '../utils/agent-katcon.js';

// ════════════════════════════════════════════════════════════════════════════
// CRON: AGENTE KATCON — RED DE SEGURIDAD del disparador event-driven.
//
// El disparador PRINCIPAL ya no vive aquí: es event-driven en el extractor
// (api/ai/agent.js → maybeSendKatconOnComplete), que manda el PUNTO KATCON en el
// INSTANTE en que Brenda termina la extracción, sin abrir el chat ni esperar.
//
// Este cron es solo el BACKSTOP: barre cada 15 min a los candidatos frescos por si
// el evento se perdió (deploy justo al completar, error puntual, toggle prendido
// después de que alguien completó). El claim atómico (SADD) garantiza que nunca haya
// doble envío entre el evento y el cron.
//
// CONSUMO MÍNIMO: solo lee candidatos con actividad DESPUÉS del corte (agentModeSince)
// vía zrevrangebyscore — no barre miles. La mayoría de las veces no encuentra nada que
// mandar (el evento ya los atendió y quedaron con SADD puesto).
// ════════════════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
    // Auth de cron (igual que send-reminders): solo Vercel Cron con el secreto.
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
        return res.status(401).json({ error: 'No autorizado' });
    }

    const redis = getRedisClient();
    if (!redis) return res.status(500).json({ error: 'Redis unavailable' });

    try {
        // ── CANDADO MAESTRO: el toggle de Oscar ──
        const { on, since } = await getToggleState();
        if (!on) {
            return res.status(200).json({ ok: true, skipped: 'toggle OFF (agentMode del perfil de Oscar)' });
        }
        if (!since) {
            return res.status(200).json({ ok: true, skipped: 'sin agentModeSince (apaga y prende el toggle para fijar el corte)' });
        }

        // ── El mensaje de banco PUNTO KATCON (exacto) ──
        const bank = await getPuntoKatconBank(redis);
        if (!bank) {
            return res.status(200).json({ ok: true, error: `No encontré el mensaje de banco "${BANK_NAME}"` });
        }

        // ── Escaneo de elegibles — SOLO los frescos (CONSUMO MÍNIMO) ──
        // El zset candidates:list está ordenado por ultimoMensaje (score). zrevrangebyscore
        // trae SOLO los candidatos con actividad >= el corte, en vez de leer miles de viejos.
        // Al prender el toggle (since=ahora) devuelve 0-poquitos; solo crece con los nuevos.
        const ids = await redis.zrevrangebyscore('candidates:list', '+inf', since);
        if (!ids.length) {
            return res.status(200).json({ ok: true, elegibles: 0, enviados: 0, nota: 'sin candidatos nuevos desde el corte' });
        }
        const pipe = redis.pipeline();
        ids.forEach(id => pipe.get(`candidate:${id}`));
        const rows = await pipe.exec();

        const eligible = [];
        for (const [, raw] of rows) {
            if (!raw) continue;
            let c;
            try { c = JSON.parse(raw); } catch { continue; }
            if (!cumpleCandados(c)) continue;                        // completo + tag + !blocked
            const lastAct = new Date(c.lastUserMessageAt || c.ultimoMensaje || c.primerContacto || 0).getTime();
            if (lastAct < since) continue;                           // corte (solo posteriores a prender el toggle)
            eligible.push(c);
        }

        let sent = 0, claimed = 0, yaCitado = 0, errors = 0;
        const detail = [];

        for (const c of eligible) {
            if (sent >= BATCH_CAP) break;                            // tope por corrida (rampa suave)
            const r = await sendPuntoKatconTo(redis, c, bank.pk, bank.bankImages);
            if (r === 'sent') { sent++; detail.push({ id: c.id, nombre: c.nombreReal || c.nombre }); }
            else if (r === 'claimed') claimed++;                     // ya atendido (por el evento, normalmente)
            else if (r === 'yaCitado') yaCitado++;
            else errors++;
        }

        return res.status(200).json({
            ok: true,
            elegibles: eligible.length,
            enviados: sent,
            yaAtendidos: claimed,
            yaCitados: yaCitado,
            errores: errors,
            topePorCorrida: BATCH_CAP,
            detalle: detail,
            nota: 'red de seguridad; el disparo principal es event-driven en el extractor'
        });
    } catch (error) {
        console.error('[AGENT-KATCON] error general:', error);
        return res.status(500).json({ ok: false, error: error.message });
    }
}
