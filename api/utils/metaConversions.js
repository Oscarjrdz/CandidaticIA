/**
 * Meta Conversions API — Server-side event tracking for WhatsApp CTWA ads.
 *
 * Closes the attribution loop: sends conversion events back to Meta so the
 * algorithm knows which ads generated real qualified leads (not just clicks).
 *
 * Requires env vars:
 *   META_PIXEL_ID          — Pixel / Dataset ID from Meta Business Manager
 *   META_CONVERSIONS_TOKEN — System User token with Conversions API permission
 *                            (falls back to META_ADS_TOKEN if not set)
 *
 * Events fired:
 *   Lead                 — new candidate contacts from a CTWA ad (webhook)
 *   CompleteRegistration — candidate's profile becomes 100% complete (storage)
 */

import crypto from 'crypto';

const GRAPH_URL = 'https://graph.facebook.com/v21.0';

/** SHA-256 hash a phone number (Meta requirement for PII matching) */
const hashPhone = (phone) => {
    if (!phone) return null;
    const normalized = String(phone).replace(/\D/g, '');
    if (!normalized) return null;
    return crypto.createHash('sha256').update(normalized).digest('hex');
};

/**
 * Send a conversion event to Meta Conversions API.
 *
 * @param {object} opts
 * @param {string} opts.eventName   — 'Lead' | 'CompleteRegistration' | 'Schedule'
 * @param {string} [opts.phone]     — raw phone (will be hashed)
 * @param {string} [opts.ctwaClid]  — ctwa_clid from Meta referral (most accurate signal)
 * @param {object} [opts.customData]— extra context (vacancy, adHeadline, etc.)
 */
export const sendConversionEvent = async ({ eventName, phone, ctwaClid, customData = {} }) => {
    const pixelId = process.env.META_PIXEL_ID;
    const token = process.env.META_CONVERSIONS_TOKEN || process.env.META_ADS_TOKEN;

    if (!pixelId || !token) return; // not configured — silent skip

    const userData = {};
    if (ctwaClid) userData.ctwa_clid = ctwaClid;
    const hashedPhone = hashPhone(phone);
    if (hashedPhone) userData.ph = [hashedPhone];

    if (!userData.ctwa_clid && !userData.ph) return; // need at least one signal

    const payload = {
        data: [{
            event_name: eventName,
            event_time: Math.floor(Date.now() / 1000),
            action_source: 'system_generated',
            user_data: userData,
            ...(Object.keys(customData).length > 0 && { custom_data: customData }),
        }],
        partner_agent: 'candidatic_ia',
        access_token: token,
    };

    try {
        const res = await fetch(`${GRAPH_URL}/${pixelId}/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) {
            console.error(`[Conversions API] ${eventName} error:`, JSON.stringify(data));
        } else {
            console.log(`[Conversions API] ${eventName} sent — events_received: ${data.events_received}`);
        }
    } catch (err) {
        console.error(`[Conversions API] ${eventName} fetch failed:`, err.message);
    }
};
