/**
 * Lightweight unread counter for the Chat Web sidebar badge.
 * Avoids returning candidate profiles to the shell just to compute a number.
 */
export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const {
            getRedisClient,
            getUsers,
            getRoles,
            validateAdminSession,
            isProfileComplete
        } = await import('./utils/storage.js');

        const userId = await validateAdminSession(req);
        if (!userId) return res.status(401).json({ error: 'No autorizado' });

        const redis = getRedisClient();
        if (!redis) return res.status(500).json({ error: 'Redis unavailable' });

        const users = await getUsers();
        const user = users.find(u => u.id === userId || u.whatsapp === userId);
        if (!user) return res.status(200).json({ success: true, unreadCount: 0 });

        const roles = await getRoles();
        const role = roles.find(r => r.name === user.role);
        const rolePermissions = role?.permissions || {};

        const [unreadSetSize, unreadVersionRaw] = await Promise.all([
            redis.scard('candidates:unread'),
            redis.get('stats:unread:version')
        ]);
        const unreadVersion = unreadVersionRaw || '0';
        const restrictionSig = JSON.stringify({
            role: user.role || '',
            crm: Array.isArray(user.allowed_crm_projects) ? [...user.allowed_crm_projects].sort() : [],
            labels: Array.isArray(user.allowed_labels) ? [...user.allowed_labels].sort() : [],
            viewIncomplete: rolePermissions.view_incomplete_candidates === true
        });
        const cacheKey = `cache:chat_unread_count:${userId}:${Buffer.from(restrictionSig).toString('base64url')}:${unreadSetSize}:${unreadVersion}`;
        const cached = await redis.get(cacheKey);
        if (cached) {
            res.setHeader('Cache-Control', 'private, max-age=5');
            return res.status(200).json(JSON.parse(cached));
        }

        const canSeeIncomplete =
            user.role === 'SuperAdmin' ||
            !rolePermissions ||
            Object.keys(rolePermissions).length === 0 ||
            rolePermissions.view_incomplete_candidates === true;

        const allowedCrm = user?.allowed_crm_projects;
        const hasCrmRestriction = Array.isArray(allowedCrm) && allowedCrm.length > 0;
        const allowedLabels = user?.allowed_labels;
        const hasLabelRestriction = Array.isArray(allowedLabels) && allowedLabels.length > 0;
        const hasRBACRestriction = user.role !== 'SuperAdmin' && user.role !== 'Admin' && (hasCrmRestriction || hasLabelRestriction);

        const counts = { all: 0, complete: 0, incomplete: 0, tags: {}, completeTags: {}, incompleteTags: {}, crmProjects: {} };
        if (!unreadSetSize) {
            const payload = { success: true, unreadCount: 0, counts };
            await redis.set(cacheKey, JSON.stringify(payload), 'EX', 8).catch(() => {});
            res.setHeader('Cache-Control', 'private, max-age=5');
            return res.status(200).json(payload);
        }

        const unreadIds = await redis.smembers('candidates:unread');

        const customFieldsRaw = await redis.get('custom_fields');
        const customFields = customFieldsRaw ? JSON.parse(customFieldsRaw) : [];
        const allowedLabelSet = new Set(
            (allowedLabels || [])
                .filter(label => typeof label === 'string')
                .map(label => label.trim().toLowerCase())
        );

        const CHUNK = 200;
        for (let i = 0; i < unreadIds.length; i += CHUNK) {
            const ids = unreadIds.slice(i, i + CHUNK);
            const pipe = redis.pipeline();
            ids.forEach(id => pipe.get(`candidate:${id}`));
            const results = await pipe.exec();

            for (const [err, raw] of results) {
                if (err || !raw) continue;
                let candidate;
                try { candidate = JSON.parse(raw); } catch { continue; }

                const userTime = candidate.lastUserMessageAt ? new Date(candidate.lastUserMessageAt).getTime() : 0;
                const humanTime = candidate.lastHumanMessageAt ? new Date(candidate.lastHumanMessageAt).getTime() : 0;
                if (!userTime || userTime <= humanTime) continue;

                if (hasRBACRestriction) {
                    const inAllowedCrm = hasCrmRestriction && candidate?.manualProjectId && allowedCrm.includes(candidate.manualProjectId);
                    const inAllowedLabel = hasLabelRestriction && Array.isArray(candidate?.tags) && candidate.tags.some(t => {
                        const name = typeof t === 'string' ? t.trim().toLowerCase() : (t?.name?.trim()?.toLowerCase() || '');
                        return name && allowedLabelSet.has(name);
                    });
                    if (!inAllowedCrm && !inAllowedLabel) continue;
                }

                const complete = candidate.statusAudit === 'complete' || isProfileComplete(candidate, customFields);
                if (!complete && !canSeeIncomplete) continue;

                counts.all++;
                if (complete) counts.complete++;
                else counts.incomplete++;

                if (Array.isArray(candidate.tags)) {
                    for (const tag of candidate.tags) {
                        const tagName = typeof tag === 'string' ? tag : tag?.name;
                        const normalized = tagName?.trim().toLowerCase();
                        if (normalized) {
                            counts.tags[normalized] = (counts.tags[normalized] || 0) + 1;
                            if (complete) counts.completeTags[normalized] = (counts.completeTags[normalized] || 0) + 1;
                            else counts.incompleteTags[normalized] = (counts.incompleteTags[normalized] || 0) + 1;
                        }
                    }
                }

                if (candidate.manualProjectId) {
                    counts.crmProjects[candidate.manualProjectId] = (counts.crmProjects[candidate.manualProjectId] || 0) + 1;
                }
            }
        }

        const payload = { success: true, unreadCount: counts.all, counts };
        await redis.set(cacheKey, JSON.stringify(payload), 'EX', 8).catch(() => {});
        res.setHeader('Cache-Control', 'private, max-age=5');
        return res.status(200).json(payload);
    } catch (error) {
        console.error('Chat unread count error:', error);
        return res.status(500).json({ error: 'Internal error', details: error.message });
    }
}
