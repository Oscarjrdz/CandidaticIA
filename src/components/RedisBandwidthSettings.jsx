import React, { useState, useEffect } from 'react';
import { Activity, Loader2, ExternalLink } from 'lucide-react';
import Card from './ui/Card';

function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n <= 0) return '0 MB';
    const mb = n / (1024 * 1024);
    if (mb < 1024) return `${mb.toFixed(1)} MB`;
    return `${(mb / 1024).toFixed(2)} GB`;
}

function formatNum(n) {
    n = Number(n) || 0;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
    return String(n);
}

const SCAN_LABELS = { filter_counts: 'Scan filtros', ads_stats: 'Scan ads' };

function sumLastDays(days, count) {
    return days.slice(0, count).reduce((acc, d) => {
        acc.netInputBytes += d.netInputBytes;
        acc.netOutputBytes += d.netOutputBytes;
        return acc;
    }, { netInputBytes: 0, netOutputBytes: 0 });
}

function dayLabel(ymd) {
    const d = new Date(`${ymd}T12:00:00.000Z`);
    return d.toLocaleDateString('es-MX', { timeZone: 'America/Monterrey', day: 'numeric', month: 'short' }).replace('.', '');
}

// Dia 1 al ultimo dia del mes calendario actual (zona horaria Monterrey) — no
// una ventana movil de N dias. Los dias futuros dentro del mes se rellenan
// vacios hasta que el medidor real los alcance.
function currentMonthDayKeys() {
    const mtyToday = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Monterrey' });
    const [year, month] = mtyToday.split('-').map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();
    return Array.from({ length: daysInMonth }, (_, i) => {
        const day = String(i + 1).padStart(2, '0');
        return `${year}-${String(month).padStart(2, '0')}-${day}`;
    });
}

const RedisBandwidthSettings = () => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch('/api/system/bandwidth?days=31');
                const json = await res.json();
                if (json.success) setData(json);
                else setError(true);
            } catch {
                setError(true);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const today = data?.today;
    const last7 = data?.days ? sumLastDays(data.days, 7) : null;
    const last30 = data?.totals || null;
    const hasHistory = data?.days?.some(d => d.samples > 0);
    // Vista de mes calendario: dia 1 a la izquierda, ultimo dia del mes a la
    // derecha. Los dias futuros (aun no alcanzados por el medidor) quedan en 0.
    const dataByDay = new Map((data?.days || []).map(d => [d.day, d]));
    const chartDays = currentMonthDayKeys().map(day => dataByDay.get(day) || {
        day, netInputBytes: 0, netOutputBytes: 0, commandsProcessed: 0, samples: 0
    });
    const maxDayBytes = Math.max(...chartDays.map(d => d.netInputBytes + d.netOutputBytes), 1);

    return (
        <Card title="Ancho de Banda" icon={Activity}>
            <div className="space-y-3 pb-1">
                {loading ? (
                    <div className="flex items-center justify-center py-4">
                        <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                    </div>
                ) : error || !hasHistory ? (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        {error
                            ? 'No se pudo cargar el consumo.'
                            : 'Todavía no hay suficientes datos — se acumulan cada 15 minutos desde ahora.'}
                    </p>
                ) : (
                    <div className="grid grid-cols-3 gap-2">
                        <div className="bg-[#f0f2f5] dark:bg-[#202c33] rounded-lg p-2.5 text-center">
                            <div className="text-[9px] font-bold text-gray-400 uppercase mb-1">Hoy</div>
                            <div className="text-sm font-bold text-gray-900 dark:text-gray-100">
                                {formatBytes((today?.netInputBytes || 0) + (today?.netOutputBytes || 0))}
                            </div>
                        </div>
                        <div className="bg-[#f0f2f5] dark:bg-[#202c33] rounded-lg p-2.5 text-center">
                            <div className="text-[9px] font-bold text-gray-400 uppercase mb-1">7 días</div>
                            <div className="text-sm font-bold text-gray-900 dark:text-gray-100">
                                {formatBytes(last7.netInputBytes + last7.netOutputBytes)}
                            </div>
                        </div>
                        <div className="bg-[#f0f2f5] dark:bg-[#202c33] rounded-lg p-2.5 text-center">
                            <div className="text-[9px] font-bold text-gray-400 uppercase mb-1">30 días</div>
                            <div className="text-sm font-bold text-gray-900 dark:text-gray-100">
                                {formatBytes(last30.netInputBytes + last30.netOutputBytes)}
                            </div>
                        </div>
                    </div>
                )}

                {!loading && !error && hasHistory && (
                    <div>
                        <div className="flex items-end gap-px" style={{ height: '56px' }}>
                            {chartDays.map((d) => {
                                const total = d.netInputBytes + d.netOutputBytes;
                                const heightPct = Math.max((total / maxDayBytes) * 100, total > 0 ? 4 : 0);
                                return (
                                    <div
                                        key={d.day}
                                        className="flex-1 flex flex-col justify-end min-w-0 group/bar relative h-full"
                                    >
                                        <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-gray-800 dark:bg-gray-600 text-white text-[8px] rounded px-1.5 py-0.5 whitespace-nowrap opacity-0 group-hover/bar:opacity-100 pointer-events-none transition-opacity z-10">
                                            {dayLabel(d.day)} · {formatBytes(total)}
                                        </div>
                                        <div
                                            className="w-full rounded-t-sm bg-indigo-400 dark:bg-indigo-500 group-hover/bar:bg-indigo-600 transition-colors"
                                            style={{ height: `${heightPct}%` }}
                                        />
                                    </div>
                                );
                            })}
                        </div>
                        <div className="flex items-center justify-between mt-1">
                            <span className="text-[8px] text-gray-400 dark:text-gray-500">{dayLabel(chartDays[0]?.day)}</span>
                            <span className="text-[8px] text-gray-400 dark:text-gray-500">{dayLabel(chartDays[chartDays.length - 1]?.day)}</span>
                        </div>
                    </div>
                )}

                {!loading && !error && data && ((data.commandsToday?.length > 0) || (data.scansToday?.length > 0) || data.avgBlobBytesToday > 0) && (
                    <div className="border-t border-gray-100 dark:border-gray-700 pt-2 space-y-2">
                        <div className="flex items-center justify-between text-[10px]">
                            <span className="font-bold text-gray-400 uppercase">Desglose de hoy (dato real)</span>
                            {data.avgBlobBytesToday > 0 && (
                                <span className="text-gray-500 dark:text-gray-400">
                                    Candidato prom.: <strong className="text-gray-700 dark:text-gray-200">{(data.avgBlobBytesToday / 1024).toFixed(1)} KB</strong>
                                </span>
                            )}
                        </div>

                        {data.scansToday?.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                                {data.scansToday.map(s => (
                                    <span key={s.source} className="text-[9px] px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300">
                                        {SCAN_LABELS[s.source] || s.source}: <strong>{s.count}</strong>
                                    </span>
                                ))}
                            </div>
                        )}

                        {data.commandsToday?.length > 0 && (
                            <div className="space-y-1">
                                <div className="text-[9px] text-gray-400">Comandos más usados hoy (nº de llamadas)</div>
                                {data.commandsToday.slice(0, 6).map(c => {
                                    const max = data.commandsToday[0].calls || 1;
                                    const pct = Math.max((c.calls / max) * 100, 4);
                                    return (
                                        <div key={c.cmd} className="flex items-center gap-2">
                                            <span className="text-[9px] font-mono text-gray-500 dark:text-gray-400 w-16 shrink-0 truncate">{c.cmd}</span>
                                            <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-700 rounded overflow-hidden">
                                                <div className="h-full bg-indigo-400 dark:bg-indigo-500" style={{ width: `${pct}%` }} />
                                            </div>
                                            <span className="text-[9px] text-gray-400 w-12 text-right shrink-0">{formatNum(c.calls)}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                <p className="text-[10px] text-gray-400 leading-relaxed">
                    Medido directo del contador de red de Redis (no es un estimado). Para el total oficial de la cuenta, revisa{' '}
                    <a
                        href="https://cloud.redis.io"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-0.5 text-blue-500 hover:underline"
                    >
                        Redis Cloud <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                    {' '}&gt; Configuration &gt; Monthly network used.
                </p>
            </div>
        </Card>
    );
};

export default RedisBandwidthSettings;
