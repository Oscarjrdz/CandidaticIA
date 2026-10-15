/**
 * /api/mcp/config  —  Panel de control del MCP (para el dashboard).
 *
 * Lo consume la tarjeta "MCP (Grok)" en Configuración → WhatsApp.
 * NO es el endpoint del protocolo MCP (ese es /api/mcp). Aquí solo se:
 *   - prende/apaga el MCP (kill switch `mcp:enabled`)
 *   - muestra/rota el token (`mcp:token`) que Grok usa como Bearer
 *
 * Auth: sesión de reclutador (validateAdminSession), igual que el resto del dashboard.
 */

import { randomBytes } from 'crypto';

const ENABLED_KEY = 'mcp:enabled';
const TOKEN_KEY = 'mcp:token';

function newToken() {
    return `cmcp_${randomBytes(24).toString('hex')}`;
}

async function ensureToken(redis) {
    let token = await redis.get(TOKEN_KEY);
    if (!token) {
        token = newToken();
        await redis.set(TOKEN_KEY, token);
    }
    return token;
}

export default async function handler(req, res) {
    try {
        const { getRedisClient, validateAdminSession } = await import('../utils/storage.js');

        const userId = await validateAdminSession(req);
        if (!userId) return res.status(401).json({ error: 'No autorizado' });

        const redis = getRedisClient();
        if (!redis) return res.status(503).json({ error: 'Redis no disponible' });

        if (req.method === 'GET') {
            const [enabledRaw, token, logRaw] = await Promise.all([
                redis.get(ENABLED_KEY),
                ensureToken(redis),
                redis.lrange('mcp:log', 0, 24)
            ]);
            const recentLog = (logRaw || []).map(s => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
            return res.status(200).json({
                success: true,
                enabled: enabledRaw === '1' || enabledRaw === 'true',
                token,
                path: '/api/mcp',
                recentLog
            });
        }

        if (req.method === 'PUT') {
            const { enabled, action } = req.body || {};

            if (action === 'rotate') {
                const token = newToken();
                await redis.set(TOKEN_KEY, token);
                return res.status(200).json({ success: true, token });
            }

            if (typeof enabled === 'boolean') {
                await redis.set(ENABLED_KEY, enabled ? '1' : '0');
                return res.status(200).json({ success: true, enabled });
            }

            return res.status(400).json({ error: 'Nada que actualizar (enabled:boolean o action:"rotate")' });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
