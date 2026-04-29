import { getRedisClient } from './utils/storage.js';

export default async function handler(req, res) {
    const client = getRedisClient();
    if (!client) return res.status(500).send('No Redis');

    const filter = req.query.phone || '';

    try {
        const raw = await client.lrange('debug:webhook_history', 0, 49);
        const entries = raw.map(r => JSON.parse(r));

        let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Webhook Viewer</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body { font-family: -apple-system, sans-serif; background: #0b141a; color: #e9edef; padding: 16px; margin: 0; }
            h1 { color: #25d366; font-size: 18px; }
            .filter { margin-bottom: 16px; }
            .filter input { background: #202c33; border: 1px solid #374151; color: #e9edef; padding: 8px 12px; border-radius: 8px; font-size: 14px; width: 250px; }
            .filter button { background: #25d366; color: white; border: none; padding: 8px 16px; border-radius: 8px; cursor: pointer; margin-left: 8px; }
            .entry { background: #202c33; border-radius: 12px; padding: 12px 16px; margin-bottom: 8px; border-left: 4px solid #374151; }
            .entry.msg-in { border-left-color: #25d366; }
            .entry.msg-out { border-left-color: #3b82f6; }
            .entry.status { border-left-color: #8696a0; }
            .entry.target { box-shadow: 0 0 0 2px #f59e0b; }
            .ts { color: #8696a0; font-size: 11px; }
            .type { font-weight: bold; font-size: 13px; }
            .type.msg { color: #25d366; }
            .type.sts { color: #8696a0; }
            .detail { color: #aebac1; font-size: 12px; margin-top: 4px; }
            .phone { color: #00a884; font-weight: bold; }
            .text { color: #e9edef; background: #111b21; padding: 4px 8px; border-radius: 6px; display: inline-block; margin-top: 4px; }
            .raw { font-size: 10px; color: #54656f; margin-top: 6px; word-break: break-all; max-height: 80px; overflow: auto; display: none; }
            .toggle { color: #667781; font-size: 10px; cursor: pointer; text-decoration: underline; }
            .count { color: #8696a0; font-size: 12px; }
            .refresh { color: #25d366; text-decoration: none; margin-left: 12px; }
        </style></head><body>
        <h1>📡 Webhook Viewer <a href="/api/webhook-viewer${filter ? '?phone=' + filter : ''}" class="refresh">🔄 Refresh</a></h1>
        <div class="filter">
            <form method="GET">
                <input name="phone" placeholder="Filtrar por teléfono (ej: 8136505788)" value="${filter}" />
                <button type="submit">Filtrar</button>
                ${filter ? '<a href="/api/webhook-viewer" style="color:#f59e0b;margin-left:8px;">Limpiar</a>' : ''}
            </form>
        </div>
        <p class="count">Mostrando ${entries.length} webhooks</p>`;

        for (const e of entries) {
            const payload = e.payload || {};
            const rawStr = JSON.stringify(payload);
            const ts = e.ts || '';
            const changes = payload.entry?.[0]?.changes?.[0]?.value || {};
            const meta = changes.metadata || {};
            const msgs = changes.messages || [];
            const statuses = changes.statuses || [];
            const contacts = changes.contacts || [];

            const hasTarget = filter && rawStr.includes(filter);
            if (filter && !hasTarget) continue;

            if (msgs.length > 0) {
                const m = msgs[0];
                const contactName = contacts[0]?.profile?.name || '';
                html += `<div class="entry msg-in ${hasTarget ? 'target' : ''}">
                    <div class="ts">${ts}</div>
                    <div class="type msg">📩 MENSAJE ENTRANTE</div>
                    <div class="detail">De: <span class="phone">${m.from}</span> ${contactName ? `(${contactName})` : ''}</div>
                    <div class="detail">Tipo: ${m.type} | ID: ${m.id}</div>
                    ${m.text ? `<div class="text">${m.text.body}</div>` : ''}
                    ${m.type === 'image' ? '<div class="detail">📷 Imagen</div>' : ''}
                    ${m.type === 'audio' ? '<div class="detail">🎤 Audio</div>' : ''}
                    ${m.type === 'sticker' ? '<div class="detail">🎨 Sticker</div>' : ''}
                    ${m.type === 'document' ? '<div class="detail">📄 Documento</div>' : ''}
                    ${m.type === 'video' ? '<div class="detail">🎬 Video</div>' : ''}
                    ${m.type === 'reaction' ? `<div class="detail">👍 Reacción: ${m.reaction?.emoji || ''}</div>` : ''}
                    <div class="detail">Para: ${meta.display_phone_number} (ID: ${meta.phone_number_id})</div>
                    <span class="toggle" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='block'?'none':'block'">ver raw</span>
                    <div class="raw">${rawStr}</div>
                </div>`;
            } else if (statuses.length > 0) {
                const s = statuses[0];
                const emoji = { sent: '📤', delivered: '✅', read: '👁️', failed: '❌' }[s.status] || '❓';
                html += `<div class="entry status ${hasTarget ? 'target' : ''}">
                    <div class="ts">${ts}</div>
                    <div class="type sts">${emoji} STATUS: ${s.status?.toUpperCase()}</div>
                    <div class="detail">Para: <span class="phone">${s.recipient_id}</span></div>
                    ${s.errors ? `<div class="detail" style="color:#ef4444">Error: ${JSON.stringify(s.errors)}</div>` : ''}
                    <span class="toggle" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='block'?'none':'block'">ver raw</span>
                    <div class="raw">${rawStr}</div>
                </div>`;
            } else {
                html += `<div class="entry">
                    <div class="ts">${ts}</div>
                    <div class="type">❓ OTRO</div>
                    <span class="toggle" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='block'?'none':'block'">ver raw</span>
                    <div class="raw">${rawStr}</div>
                </div>`;
            }
        }

        html += '</body></html>';
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(200).send(html);
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
