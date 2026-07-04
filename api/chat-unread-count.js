/**
 * Lightweight unread counter for the Chat Web sidebar badge.
 * Avoids returning candidate profiles to the shell just to compute a number.
 */
import { Buffer } from 'node:buffer';
import { getCachedConfig } from './utils/cache.js';

const AGGREGATE_CACHE_TTL_SECONDS = 60;

function createEmptyCounts() {
    return {
        all: 0,
        complete: 0,
        incomplete: 0,
        untagged: 0,
        completeUntagged: 0,
        incompleteUntagged: 0,
        tags: {},
        completeTags: {},
        incompleteTags: {},
        crmProjects: {}
    };
}

function normalizeTagName(tag) {
    return typeof tag === 'string'
        ? tag.trim().toLowerCase()
        : (tag?.name?.trim()?.toLowerCase() || '');
}

function incrementCounts(counts, summary) {
    counts.all++;
    if (summary.complete) counts.complete++;
    else counts.incomplete++;

    if (!summary.tags.length) {
        counts.untagged++;
        if (summary.complete) counts.completeUntagged++;
        else counts.incompleteUntagged++;
    } else {
        for (const tag of summary.tags) {
            counts.tags[tag] = (counts.tags[tag] || 0) + 1;
            if (summary.complete) counts.completeTags[tag] = (counts.completeTags[tag] || 0) + 1;
            else counts.incompleteTags[tag] = (counts.incompleteTags[tag] || 0) + 1;
        }
    }

    if (summary.manualProjectId) {
        counts.crmProjects[summary.manualProjectId] = (counts.crmProjects[summary.manualProjectId] || 0) + 1;
    }
}

async function readOrBuildUnreadAggregate({ redis, unreadIds, unreadVersion, isProfileComplete }) {
    const aggregateKey = `cache:chat_unread_aggregate:${unreadVersion}:${unreadIds.length}`;
    const cachedAggregate = await redis.get(aggregateKey).catch(() => null);
    if (cachedAggregate) {
        try {
            return {
                ...JSON.parse(cachedAggregate),
                cacheHit: true,
                cacheBytes: Buffer.byteLength(cachedAggregate)
            };
        } catch {
            // Fall through and rebuild the aggregate if a cached payload is malformed.
        }
    }

    const counts = createEmptyCounts();
    const summaries = [];
    let candidateReads = 0;
    let estimatedRedisBytes = 0;
    const customFieldsRaw = await getCachedConfig(redis, 'custom_fields').catch(() => null);
    const customFields = customFieldsRaw ? JSON.parse(customFieldsRaw) : [];

    const CHUNK = 200;
    for (let i = 0; i < unreadIds.length; i += CHUNK) {
        const ids = unreadIds.slice(i, i + CHUNK);
        const pipe = redis.pipeline();
        ids.forEach(id => pipe.get(`candidate:${id}`));
        const results = await pipe.exec();
        candidateReads += ids.length;

        for (const [err, raw] of results) {
            if (err || !raw) continue;
            estimatedRedisBytes += Buffer.byteLength(raw);

            let candidate;
            try { candidate = JSON.parse(raw); } catch { continue; }

            const userTime = candidate.lastUserMessageAt ? new Date(candidate.lastUserMessageAt).getTime() : 0;
            const humanTime = candidate.lastHumanMessageAt ? new Date(candidate.lastHumanMessageAt).getTime() : 0;
            if (!userTime || userTime <= humanTime) continue;

            const summary = {
                id: candidate.id,
                incomingPhoneNumberId: candidate.incomingPhoneNumberId || '',
                manualProjectId: candidate.manualProjectId || '',
                tags: Array.isArray(candidate.tags)
                    ? candidate.tags.map(normalizeTagName).filter(Boolean)
                    : [],
                complete: candidate.statusAudit === 'complete' || isProfileComplete(candidate, customFields)
            };

            summaries.push(summary);
            incrementCounts(counts, summary);
        }
    }

    const aggregate = { counts, summaries };
    await redis.set(aggregateKey, JSON.stringify(aggregate), 'EX', AGGREGATE_CACHE_TTL_SECONDS).catch(() => {});

    return {
        ...aggregate,
        cacheHit: false,
        candidateReads,
        estimatedRedisBytes
    };
}

function filterAggregateCounts({
    summaries,
    user,
    rolePermissions,
    allowedCrm,
    allowedWa,
    allowedLabelSet
}) {
    const canSeeIncomplete =
        user.role === 'SuperAdmin' ||
        !rolePermissions ||
        Object.keys(rolePermissions).length === 0 ||
        rolePermissions.view_incomplete_candidates === true;
    const hasCrmRestriction = Array.isArray(allowedCrm) && allowedCrm.length > 0;
    const hasWaRestriction = Array.isArray(allowedWa) && allowedWa.length > 0;
    const hasLabelRestriction = allowedLabelSet.size > 0;
    const hasRBACRestriction = user.role !== 'SuperAdmin' && user.role !== 'Admin' && (hasCrmRestriction || hasLabelRestriction);
    const counts = createEmptyCounts();

    for (const summary of summaries) {
        if (user.role !== 'SuperAdmin' && user.role !== 'Admin' && hasWaRestriction) {
            if (!summary.incomingPhoneNumberId || !allowedWa.includes(summary.incomingPhoneNumberId)) continue;
        }

        if (hasRBACRestriction) {
            const inAllowedCrm = hasCrmRestriction && summary.manualProjectId && allowedCrm.includes(summary.manualProjectId);
            const inAllowedLabel = hasLabelRestriction && summary.tags.some(tag => allowedLabelSet.has(tag));
            if (!inAllowedCrm && !inAllowedLabel) continue;
        }

        if (!summary.complete && !canSeeIncomplete) continue;
        incrementCounts(counts, summary);
    }

    return counts;
}

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
            wa: Array.isArray(user.allowed_wa_numbers) ? [...user.allowed_wa_numbers].sort() : [],
            crm: Array.isArray(user.allowed_crm_projects) ? [...user.allowed_crm_projects].sort() : [],
            labels: Array.isArray(user.allowed_labels) ? [...user.allowed_labels].sort() : [],
            viewIncomplete: rolePermissions.view_incomplete_candidates === true
        });
        const cacheKey = `cache:chat_unread_count:${userId}:${Buffer.from(restrictionSig).toString('base64url')}:${unreadSetSize}:${unreadVersion}`;
        const cached = await redis.get(cacheKey);
        if (cached) {
            const payload = JSON.parse(cached);
            res.setHeader('Cache-Control', 'private, max-age=5');
            return res.status(200).json(payload);
        }

        const canSeeIncomplete =
            user.role === 'SuperAdmin' ||
            !rolePermissions ||
            Object.keys(rolePermissions).length === 0 ||
            rolePermissions.view_incomplete_candidates === true;

        const allowedCrm = user?.allowed_crm_projects;
        const hasCrmRestriction = Array.isArray(allowedCrm) && allowedCrm.length > 0;
        const allowedWa = user?.allowed_wa_numbers;
        const hasWaRestriction = Array.isArray(allowedWa) && allowedWa.length > 0;
        const allowedLabels = user?.allowed_labels;
        const hasLabelRestriction = Array.isArray(allowedLabels) && allowedLabels.length > 0;
        const appliesUserRestrictions = user.role !== 'SuperAdmin' && user.role !== 'Admin';
        const hasRBACRestriction = user.role !== 'SuperAdmin' && user.role !== 'Admin' && (hasCrmRestriction || hasLabelRestriction);
        if (!unreadSetSize) {
            const payload = { success: true, unreadCount: 0, counts: createEmptyCounts() };
            await redis.set(cacheKey, JSON.stringify(payload), 'EX', 8).catch(() => {});
            res.setHeader('Cache-Control', 'private, max-age=5');
            return res.status(200).json(payload);
        }

        const unreadIds = await redis.smembers('candidates:unread');
        const allowedLabelSet = new Set(
            (allowedLabels || [])
                .filter(label => typeof label === 'string')
                .map(label => label.trim().toLowerCase())
        );

        const aggregate = await readOrBuildUnreadAggregate({
            redis,
            unreadIds,
            unreadVersion,
            isProfileComplete
        });
        const canUseGlobalCounts =
            !(appliesUserRestrictions && hasWaRestriction) &&
            !hasRBACRestriction &&
            canSeeIncomplete;
        const counts = canUseGlobalCounts
            ? aggregate.counts
            : filterAggregateCounts({
                summaries: aggregate.summaries || [],
                user,
                rolePermissions,
                allowedCrm,
                allowedWa,
                allowedLabelSet
            });

        const payload = { success: true, unreadCount: counts.all, counts };
        await redis.set(cacheKey, JSON.stringify(payload), 'EX', 8).catch(() => {});
        res.setHeader('Cache-Control', 'private, max-age=5');
        return res.status(200).json(payload);
    } catch (error) {
        console.error('Chat unread count error:', error);
        return res.status(500).json({ error: 'Internal error', details: error.message });
    }
}
