/**
 * Chat utility functions — extracted from ChatSection for reusability and reduced file size.
 * These are pure functions with zero React dependencies.
 */

// ✅ META AUDIT: Intl.DateTimeFormat singletons — created ONCE, reused forever
const _fmtTime = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Monterrey', hour: 'numeric', minute: '2-digit', hour12: true });
const _fmtMidnight = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Monterrey', year: 'numeric', month: '2-digit', day: '2-digit' });
const _fmtWeekday = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Monterrey', weekday: 'long' });
const _fmtDate = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Monterrey', day: '2-digit', month: '2-digit', year: 'numeric' });

export const safeFormatTime = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';

    const timeStr = _fmtTime.format(d).replace(' p. m.', ' pm').replace(' a. m.', ' am').toLowerCase();

    // Calculate elapsed days accurately in Monterrey timezone
    const getMid = (dateObj) => {
        const str = _fmtMidnight.format(dateObj);
        const [m, day, y] = str.split('/');
        return new Date(y, m - 1, day);
    };

    const diffDays = Math.round((getMid(new Date()) - getMid(d)) / 86400000);

    if (diffDays === 0) return `Hoy ${timeStr}`;
    if (diffDays === 1) return `Ayer ${timeStr}`;
    if (diffDays > 1 && diffDays < 7) {
        const weekdayStr = _fmtWeekday.format(d);
        const capitalized = weekdayStr.charAt(0).toUpperCase() + weekdayStr.slice(1);
        return `${capitalized} ${timeStr}`;
    }

    return `${_fmtDate.format(d)} ${timeStr}`;
};

export const toTitleCase = (str) => {
    if (!str) return '';
    const trimmed = str.toString().trim();
    const lc = trimmed.toLowerCase();
    if (!trimmed || lc === 'null' || lc === 'undefined' || lc === 'none' || lc === 'n/a' || lc === '-' || lc === '.') return '';
    return trimmed.toLowerCase().split(' ').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
};

export const formatWhatsAppText = (text) => {
    if (!text) return '';
    
    // 1. First, protect HTML characters
    let processed = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    const tokens = {};
    let tokenCounter = 0;

    // Helper to store matches safely
    const storeToken = (html) => {
        const token = `@@@MEDIATOKEN${tokenCounter++}@@@`;
        tokens[token] = html;
        return token;
    };

    // 2. Validate URLs start with https:// to prevent injection, or allow safe internal relative routes
    const safeUrl = (u) => /^(https?:\/\/|\/api\/|\/uploads\/)/i.test(u) ? u : '';

    // 3. Extract specific media blocks and replace them with safe tokens
    processed = processed
        .replace(/\[Imagen Adjunta:\s*(https?:\/\/[^\s\]]+)\](?:\nCaption:\s*(.*))?/gi, (match, url, caption) => {
            const sUrl = safeUrl(url);
            if (!sUrl) return match;
            return storeToken(`<div class="mt-1 mb-1"><img src="${sUrl}" alt="Adjunto" width="200" height="200" class="max-w-[200px] aspect-square object-cover rounded shadow-sm bg-gray-100 dark:bg-gray-800" />${caption ? `<div class="text-[11px] text-gray-600 dark:text-gray-300 mt-1">${caption}</div>` : ''}</div>`);
        })
        .replace(/\[Ubicación:\s*(.*?)\s*\(([-.\d]+),\s*([-.\d]+)\)\]/gi, (match, address, lat, lng) => {
            return storeToken(`<div class="mt-1 mb-1 border border-black/10 dark:border-white/10 rounded overflow-hidden max-w-[220px]">
                <a href="https://maps.google.com/?q=${lat},${lng}" target="_blank" class="bg-gray-100 dark:bg-gray-800 p-2 text-blue-500 hover:text-blue-600 text-[11px] flex items-center gap-1 font-medium select-none whitespace-normal"><span class="text-xs shrink-0">📍</span> <span>Google Maps</span></a>
            </div>`);
        })
        .replace(/\[Sticker:\s*([^\s\]]+)\]/gi, (match, url) => {
            const sUrl = safeUrl(url);
            if (!sUrl) return match;
            return storeToken(`<div class="mt-1 mb-1"><img src="${sUrl}" alt="Sticker" width="120" height="120" class="max-w-[120px] aspect-square object-contain rounded bg-transparent" /></div>`);
        });

    // 4. Apply standard markdown formatting safely on the remaining text
    processed = processed
        .replace(/\*(.*?)\*/g, '<strong class="font-bold">$1</strong>')
        .replace(/_(.*?)_/g, '<em class="italic">$1</em>')
        .replace(/~(.*?)~/g, '<del class="line-through opacity-70">$1</del>')
        .replace(/```(.*?)```/g, '<code class="bg-black/5 dark:bg-black/30 px-1 py-0.5 rounded font-mono text-[11px]">$1</code>');

    // 4. Restore the protected tokens
    for (const [token, html] of Object.entries(tokens)) {
        processed = processed.replace(token, html);
    }

    return processed;
};

export const TAG_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#a855f7", "#ec4899", "#8b5cf6", "#64748b"];
