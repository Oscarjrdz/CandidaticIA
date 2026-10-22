import React, { useState, useEffect } from 'react';
import { Webhook, Check, Copy } from 'lucide-react';
import Card from './ui/Card';

/**
 * WebhooksSettings — Webhooks salientes: Candidatic notifica eventos (mensaje
 * entrante, chat nuevo, perfil completo…) a una URL externa (ej. Grok) con una
 * llave en el header X-Candidatic-Key. Qué eventos se mandan es configurable.
 */
let webhooksCache = null; // stale-while-revalidate para re-entrar sin salto

const WebhooksSettings = ({ showToast, className = '' }) => {
    const [cfg, setCfg] = useState(() => webhooksCache);
    const [urlDraft, setUrlDraft] = useState(webhooksCache?.url || '');
    const [busy, setBusy] = useState(false);
    const [copied, setCopied] = useState('');
    const [showLog, setShowLog] = useState(false);

    const load = async () => {
        try {
            const res = await fetch('/api/webhooks/config');
            if (res.ok) {
                const data = await res.json();
                setCfg(data);
                webhooksCache = data;
                setUrlDraft(data.url || '');
            }
        } catch { /* queda en el estado por defecto */ }
    };
    useEffect(() => { load(); }, []);

    const put = async (body) => {
        setBusy(true);
        try {
            const res = await fetch('/api/webhooks/config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (!res.ok) throw new Error();
            return await res.json();
        } catch {
            showToast?.('No se pudo guardar', 'error');
            return null;
        } finally { setBusy(false); }
    };

    const toggleEnabled = async () => {
        if (!cfg || busy) return;
        const next = !cfg.enabled;
        setCfg(c => ({ ...c, enabled: next }));
        const r = await put({ enabled: next });
        if (r) { webhooksCache = { ...cfg, enabled: next }; showToast?.(next ? 'Webhooks encendidos' : 'Webhooks apagados', 'success'); }
        else setCfg(c => ({ ...c, enabled: !next }));
    };

    const toggleEvent = async (id) => {
        if (!cfg || busy) return;
        const events = { ...(cfg.events || {}) };
        if (events[id]) delete events[id]; else events[id] = true;
        setCfg(c => ({ ...c, events }));
        const r = await put({ events });
        if (r) { webhooksCache = { ...cfg, events }; } else load();
    };

    const saveUrl = async () => {
        const r = await put({ url: urlDraft });
        if (r) { setCfg(c => ({ ...c, url: urlDraft })); webhooksCache = { ...cfg, url: urlDraft }; showToast?.('URL guardada', 'success'); }
    };

    const rotate = async () => {
        if (!window.confirm('¿Rotar la llave? El receptor dejará de validar hasta que uses la nueva.')) return;
        const r = await put({ action: 'rotate' });
        if (r?.secret) { setCfg(c => ({ ...c, secret: r.secret })); showToast?.('Llave rotada', 'success'); }
    };

    const copy = (what, value) => {
        navigator.clipboard.writeText(value);
        setCopied(what);
        showToast?.(what === 'secret' ? 'Llave copiada' : 'Copiado', 'success');
        setTimeout(() => setCopied(''), 2000);
    };

    const eventTypes = cfg?.eventTypes || [];

    return (
        <Card className={className}>
            <div className="p-5 space-y-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center">
                            <Webhook className="w-4 h-4 text-white" />
                        </div>
                        <div>
                            <h3 className="text-sm font-bold text-gray-900 dark:text-white">Webhooks salientes</h3>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400">
                                {cfg?.enabled ? 'Encendido' : 'Apagado'}
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={toggleEnabled}
                        disabled={!cfg || busy}
                        aria-pressed={!!cfg?.enabled}
                        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${cfg?.enabled ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                    >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${cfg?.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                </div>

                {/* URL */}
                <div>
                    <label className="text-[11px] font-medium text-gray-500 dark:text-gray-400">URL del webhook (POST JSON):</label>
                    <div className="flex gap-2 mt-1">
                        <input
                            type="url"
                            value={urlDraft}
                            onChange={e => setUrlDraft(e.target.value)}
                            placeholder="https://tu-servidor.com/webhook"
                            className="flex-1 p-2 bg-gray-100 dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700 text-xs font-mono text-gray-700 dark:text-gray-300"
                        />
                        <button onClick={saveUrl} disabled={busy || urlDraft === (cfg?.url || '')} className="px-3 rounded bg-indigo-600 text-white text-xs font-bold disabled:opacity-40">Guardar</button>
                    </div>
                </div>

                {/* Llave */}
                <div>
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">Llave (header <code>X-Candidatic-Key</code>):</span>
                        <div className="flex items-center gap-2">
                            <button onClick={() => cfg?.secret && copy('secret', cfg.secret)} disabled={!cfg?.secret} className="text-[10px] text-blue-600 hover:text-blue-700 font-bold flex items-center gap-1 disabled:opacity-50">
                                {copied === 'secret' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                                <span>{copied === 'secret' ? 'Copiada' : 'Copiar'}</span>
                            </button>
                            <button onClick={rotate} disabled={busy} className="text-[10px] text-amber-600 hover:text-amber-700 font-bold disabled:opacity-50">Rotar</button>
                        </div>
                    </div>
                    <code className="block w-full p-2 bg-gray-100 dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700 text-[11px] font-mono break-all text-gray-700 dark:text-gray-300">{cfg?.secret || '••••••••'}</code>
                </div>

                {/* Eventos */}
                <div>
                    <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">Eventos a enviar:</span>
                    <div className="mt-1 space-y-1">
                        {eventTypes.map(et => (
                            <label key={et.id} className={`flex items-center gap-2 text-xs ${et.activo ? 'text-gray-700 dark:text-gray-300' : 'text-gray-400'}`}>
                                <input
                                    type="checkbox"
                                    checked={!!cfg?.events?.[et.id]}
                                    onChange={() => toggleEvent(et.id)}
                                    disabled={busy}
                                    className="rounded"
                                />
                                <span className="font-mono">{et.id}</span>
                                {!et.activo && <span className="text-gray-400">· próximamente</span>}
                            </label>
                        ))}
                    </div>
                </div>

                {/* Diagnóstico */}
                <div>
                    <button onClick={() => { setShowLog(v => !v); if (!showLog) load(); }} className="text-[10px] font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                        {showLog ? '▾' : '▸'} Últimas entregas
                    </button>
                    {showLog && (
                        <div className="mt-1 max-h-40 overflow-y-auto rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-2 space-y-1">
                            {(!cfg?.recentLog || cfg.recentLog.length === 0) ? (
                                <p className="text-[10px] text-gray-400">Sin entregas registradas aún.</p>
                            ) : cfg.recentLog.map((e, i) => (
                                <div key={i} className="text-[10px] font-mono text-gray-600 dark:text-gray-300 flex items-center gap-2">
                                    <span className={e.ok ? 'text-emerald-600' : 'text-red-500'}>{e.status || (e.error ? 'ERR' : '?')}</span>
                                    <span className="text-gray-400">{(e.t || '').slice(11, 19)}</span>
                                    <span>{e.evento}</span>
                                    {e.error && <span className="text-red-400 truncate">{e.error}</span>}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </Card>
    );
};

export default WebhooksSettings;
