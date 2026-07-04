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

function sumLastDays(days, count) {
    return days.slice(0, count).reduce((acc, d) => {
        acc.netInputBytes += d.netInputBytes;
        acc.netOutputBytes += d.netOutputBytes;
        return acc;
    }, { netInputBytes: 0, netOutputBytes: 0 });
}

const RedisBandwidthSettings = () => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch('/api/system/bandwidth?days=30');
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
