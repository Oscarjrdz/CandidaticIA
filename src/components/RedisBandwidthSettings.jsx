import React, { useState, useEffect, useRef } from 'react';
import { Activity, ExternalLink } from 'lucide-react';
import Card from './ui/Card';

// Altura ya medida del contenido (persistida) → se reserva como min-height desde el
// primer render (skeleton incluido) para que la tarjeta nazca con su alto real y NO
// haya salto al entrar en frío ni al salir/re-entrar. Se re-mide y actualiza tras cargar.
const BW_HEIGHT_KEY = 'bw_card_content_h_v1';
const BW_HEIGHT_DEFAULT = 470; // aprox medido en prod; se auto-corrige tras el primer render real
let bandwidthContentH = (() => {
    try { return Number(localStorage.getItem(BW_HEIGHT_KEY)) || BW_HEIGHT_DEFAULT; } catch { return BW_HEIGHT_DEFAULT; }
})();

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

const PLAN_GB = 200;
const PLAN_BYTES = PLAN_GB * 1024 * 1024 * 1024;

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

// Caché stale-while-revalidate a nivel de módulo → re-entrar a Settings pinta la gráfica
// de ancho de banda al instante (sin skeleton ni salto) y revalida en silencio.
let bandwidthCache = null;

const RedisBandwidthSettings = () => {
    const [data, setData] = useState(() => bandwidthCache);
    const [loading, setLoading] = useState(() => !bandwidthCache);
    const [error, setError] = useState(false);
    const contentRef = useRef(null);

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch('/api/system/bandwidth?days=31');
                const json = await res.json();
                if (json.success) { setData(json); bandwidthCache = json; } // semilla para la próxima re-entrada
                else setError(true);
            } catch {
                setError(true);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    // Tras pintar el contenido real, mide su alto y lo persiste para reservarlo la
    // próxima vez (así el min-height se auto-ajusta al alto real de esta cuenta/día).
    useEffect(() => {
        if (loading || error || !contentRef.current) return;
        const h = contentRef.current.offsetHeight;
        if (h > 0 && Math.abs(h - bandwidthContentH) > 4) {
            bandwidthContentH = h;
            try { localStorage.setItem(BW_HEIGHT_KEY, String(h)); } catch { /* storage lleno/bloqueado */ }
        }
    }, [loading, error, data]);

    const today = data?.today;
    const hasHistory = data?.days?.some(d => d.samples > 0);
    // Vista de mes calendario: dia 1 a la izquierda, ultimo dia del mes a la
    // derecha. Los dias futuros (aun no alcanzados por el medidor) quedan en 0.
    const dataByDay = new Map((data?.days || []).map(d => [d.day, d]));
    const chartDays = currentMonthDayKeys().map(day => dataByDay.get(day) || {
        day, netInputBytes: 0, netOutputBytes: 0, commandsProcessed: 0, samples: 0
    });
    const maxDayBytes = Math.max(...chartDays.map(d => d.netInputBytes + d.netOutputBytes), 1);
    const monthBytes = chartDays.reduce((acc, d) => acc + d.netInputBytes + d.netOutputBytes, 0);
    const planPct = Math.min((monthBytes / PLAN_BYTES) * 100, 100);
    const planBarColor = planPct >= 90
        ? 'bg-red-500'
        : planPct >= 70
            ? 'bg-amber-500'
            : 'bg-emerald-500';

    return (
        <Card title="Ancho de Banda" icon={Activity}>
            <div
                ref={contentRef}
                className="space-y-3 pb-1"
                style={bandwidthContentH ? { minHeight: `${bandwidthContentH}px` } : undefined}
            >
                {loading ? (
                    /* Skeleton que reserva ~el alto final (3 tiles + barra de plan + gráfica +
                       desglose) para que la columna nazca con su altura y NO salte al cargar
                       — patrón anti-brinco. Ver docs/anti-brinco-secciones.md. */
                    <div className="animate-pulse space-y-3" aria-hidden="true">
                        <div className="grid grid-cols-3 gap-2">
                            {[0, 1, 2].map(i => (
                                <div key={i} className="bg-[#f0f2f5] dark:bg-[#202c33] rounded-lg p-2.5 h-[52px]" />
                            ))}
                        </div>
                        <div className="h-2.5 bg-gray-100 dark:bg-gray-700 rounded-full" />
                        <div className="flex items-end gap-px" style={{ height: '56px' }}>
                            {Array.from({ length: 31 }).map((_, i) => (
                                <div key={i} className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-t-sm" style={{ height: `${20 + ((i * 7) % 60)}%` }} />
                            ))}
                        </div>
                        <div className="border-t border-gray-100 dark:border-gray-700 pt-2 space-y-2">
                            <div className="flex items-center justify-between">
                                <div className="h-2.5 w-32 bg-gray-100 dark:bg-gray-700 rounded" />
                                <div className="h-2.5 w-24 bg-gray-100 dark:bg-gray-700 rounded" />
                            </div>
                            <div className="flex gap-1.5">
                                <div className="h-4 w-20 bg-gray-100 dark:bg-gray-700 rounded" />
                                <div className="h-4 w-16 bg-gray-100 dark:bg-gray-700 rounded" />
                            </div>
                            <div className="h-2 w-40 bg-gray-100 dark:bg-gray-700 rounded" />
                            {[0, 1, 2, 3, 4, 5].map(i => (
                                <div key={i} className="flex items-center gap-2">
                                    <div className="w-16 h-2.5 bg-gray-100 dark:bg-gray-700 rounded shrink-0" />
                                    <div className="flex-1 h-2.5 bg-gray-100 dark:bg-gray-700 rounded" />
                                    <div className="w-10 h-2.5 bg-gray-100 dark:bg-gray-700 rounded shrink-0" />
                                </div>
                            ))}
                        </div>
                    </div>
                ) : error || !hasHistory ? (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        {error
                            ? 'No se pudo cargar el consumo.'
                            : 'Todavía no hay suficientes datos — se acumulan cada 15 minutos desde ahora.'}
                    </p>
                ) : (
                    <>
                        <div className="grid grid-cols-3 gap-2">
                            <div className="bg-[#f0f2f5] dark:bg-[#202c33] rounded-lg p-2.5 text-center">
                                <div className="text-[9px] font-bold text-gray-400 uppercase mb-1">Hoy</div>
                                <div className="text-sm font-bold text-gray-900 dark:text-gray-100">
                                    {formatBytes((today?.netInputBytes || 0) + (today?.netOutputBytes || 0))}
                                </div>
                            </div>
                            <div className="bg-[#f0f2f5] dark:bg-[#202c33] rounded-lg p-2.5 text-center">
                                <div className="text-[9px] font-bold text-gray-400 uppercase mb-1">Mes</div>
                                <div className="text-sm font-bold text-gray-900 dark:text-gray-100">
                                    {formatBytes(monthBytes)}
                                </div>
                            </div>
                            <div className="bg-[#f0f2f5] dark:bg-[#202c33] rounded-lg p-2.5 text-center">
                                <div className="text-[9px] font-bold text-gray-400 uppercase mb-1">Plan</div>
                                <div className="text-sm font-bold text-gray-900 dark:text-gray-100">
                                    {PLAN_GB} GB
                                </div>
                            </div>
                        </div>
                        <div>
                            <div className="h-2.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                                <div
                                    className={`h-full rounded-full ${planBarColor} transition-all`}
                                    style={{ width: `${Math.max(planPct, monthBytes > 0 ? 1 : 0)}%` }}
                                />
                            </div>
                            <div className="flex items-center justify-between mt-1">
                                <span className="text-[9px] text-gray-400 dark:text-gray-500">
                                    {formatBytes(monthBytes)} de {PLAN_GB} GB
                                </span>
                                <span className="text-[9px] font-bold text-gray-500 dark:text-gray-400">
                                    {planPct.toFixed(1)}%
                                </span>
                            </div>
                        </div>
                    </>
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
