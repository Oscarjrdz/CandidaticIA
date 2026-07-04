import React, { useState, useEffect } from 'react';
import { Activity, Server, ArrowUpRight, AlertTriangle, ShieldCheck } from 'lucide-react';

const REDIS_BANDWIDTH_LIMIT_BYTES = 200 * 1024 * 1024 * 1024;

const getMonterreyDateParts = () => {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Monterrey',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date());

    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return {
        year: Number(values.year),
        month: Number(values.month),
        day: Number(values.day)
    };
};

const getDaysInMonth = (year, month) => new Date(year, month, 0).getDate();

const normalizeDailyData = ({ daily = [], month, daysInMonth }) => {
    const currentMty = getMonterreyDateParts();
    const [monthYear, monthNumber] = typeof month === 'string'
        ? month.split('-').map(Number)
        : [currentMty.year, currentMty.month];
    const totalDays = daysInMonth || getDaysInMonth(monthYear, monthNumber);
    const dailyByDay = new Map(
        daily.map(({ day, bytes }) => [Number(day), Number(bytes) || 0])
    );

    return Array.from({ length: totalDays }, (_, index) => {
        const day = index + 1;
        return {
            day,
            bytes: dailyByDay.get(day) || 0
        };
    });
};

const createInitialBandwidthData = () => {
    const currentMty = getMonterreyDateParts();
    return {
        usedBytes: 0,
        limitBytes: REDIS_BANDWIDTH_LIMIT_BYTES,
        percentage: 0,
        month: `${currentMty.year}-${String(currentMty.month).padStart(2, '0')}`,
        today: currentMty.day,
        daysInMonth: getDaysInMonth(currentMty.year, currentMty.month),
        daily: [],
        dataQuality: null
    };
};

const RedisMonitorSettings = () => {
    const [data, setData] = useState(createInitialBandwidthData);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [tooltip, setTooltip] = useState(null); // { day, bytes, x, y }

    useEffect(() => {
        const fetchBandwidth = async () => {
            try {
                const res = await fetch('/api/system/bandwidth');
                if (!res.ok) throw new Error('API Error');
                const result = await res.json();
                if (result.success) {
                    const currentDate = getMonterreyDateParts();
                    setData({
                        usedBytes: result.usedBytes || 0,
                        limitBytes: result.limitBytes || REDIS_BANDWIDTH_LIMIT_BYTES,
                        percentage: result.percentage || 0,
                        month: result.month || `${currentDate.year}-${String(currentDate.month).padStart(2, '0')}`,
                        today: result.today || currentDate.day,
                        daysInMonth: result.daysInMonth || getDaysInMonth(currentDate.year, currentDate.month),
                        daily: normalizeDailyData(result),
                        dataQuality: result.dataQuality || null
                    });
                } else {
                    throw new Error('API reported failure');
                }
            } catch (err) {
                console.error("Bandwidth fetch error:", err);
                setError(true);
            } finally {
                setLoading(false);
            }
        };
        fetchBandwidth();
    }, []);

    const formatGB = (bytes) => (bytes / (1024 * 1024 * 1024)).toFixed(2);
    const formatMB = (bytes) => {
        const mb = bytes / (1024 * 1024);
        if (mb >= 1000) return `${(mb / 1024).toFixed(2)} GB`;
        return `${mb.toFixed(0)} MB`;
    };

    const usedGB = formatGB(data.usedBytes);
    const limitGB = formatGB(data.limitBytes);

    let statusColor = 'bg-emerald-500';
    let statusText = 'text-emerald-500';
    let statusBg = 'bg-emerald-50';
    let statusBarColor = 'bg-emerald-500';
    let statusIcon = <ShieldCheck className="w-5 h-5 text-emerald-500" />;
    let statusMessage = "Sistema Operando Óptimamente";
    const isReconciled = data.dataQuality?.status === 'reconciled';

    if (data.percentage > 85) {
        statusColor = 'bg-red-500';
        statusText = 'text-red-600';
        statusBg = 'bg-red-50';
        statusBarColor = 'bg-red-500';
        statusIcon = <AlertTriangle className="w-5 h-5 text-red-500" />;
        statusMessage = "Peligro: Límite de Ancho de Banda Cercano";
    } else if (data.percentage > 60) {
        statusColor = 'bg-amber-400';
        statusText = 'text-amber-600';
        statusBg = 'bg-amber-50';
        statusBarColor = 'bg-amber-400';
        statusIcon = <Activity className="w-5 h-5 text-amber-500" />;
        statusMessage = "Advertencia: Consumo Elevado";
    }
    if (isReconciled) {
        statusIcon = <Activity className="w-5 h-5 text-blue-500" />;
        statusMessage = "Telemetría Reconciliada";
    }

    // Bar chart helpers
    const maxDayBytes = data.daily.length > 0 ? Math.max(...data.daily.map(d => d.bytes), 1) : 1;
    const today = data.today;

    if (loading) {
        return (
            <div className="bg-white dark:bg-gray-800 rounded-3xl p-6 border border-gray-100 dark:border-gray-700 shadow-sm animate-pulse h-64">
                <div className="flex items-center space-x-3 mb-6">
                    <div className="w-10 h-10 bg-gray-200 dark:bg-gray-700 rounded-xl"></div>
                    <div className="h-6 w-48 bg-gray-200 dark:bg-gray-700 rounded-md"></div>
                </div>
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded-full mb-3"></div>
                <div className="h-24 bg-gray-200 dark:bg-gray-700 rounded-2xl mt-4"></div>
            </div>
        );
    }

    return (
        <div className="bg-white dark:bg-gray-800 rounded-3xl p-6 border border-gray-100 dark:border-gray-700 shadow-sm relative overflow-hidden group">
            {/* Background Glow */}
            <div className={`absolute top-0 right-0 -mr-16 -mt-16 w-48 h-48 rounded-full ${statusBg} blur-3xl opacity-50 dark:opacity-20 transition-all duration-700 ease-in-out`}></div>

            <div className="relative z-10">
                <div className="flex justify-between items-start mb-6">
                    <div className="flex items-center space-x-4">
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${statusBg} shadow-sm border border-white dark:border-gray-700`}>
                            {statusIcon}
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                                Redis Telemetry
                                <span className={`text-[10px] uppercase font-black px-2 py-0.5 rounded-full ${statusBg} ${isReconciled ? 'text-blue-600' : statusText} tracking-wider`}>
                                    {isReconciled ? 'Estimado' : 'Live'}
                                </span>
                            </h3>
                            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                                Consumo de Ancho de Banda (Este Mes)
                            </p>
                        </div>
                    </div>
                    <div className="hidden sm:flex items-center space-x-1 text-xs font-semibold text-gray-400 bg-gray-50 dark:bg-gray-700/50 px-3 py-1.5 rounded-xl border border-gray-100 dark:border-gray-600">
                        <Server className="w-3.5 h-3.5 mr-1" />
                        Redis Cloud Server
                    </div>
                </div>

                {error ? (
                    <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-2xl text-sm font-medium flex items-center gap-2">
                        <AlertTriangle className="w-5 h-5" />
                        No se pudo conectar al servidor de telemetría.
                    </div>
                ) : (
                    <div>
                        {/* Monthly total + progress bar */}
                        <div className="flex justify-between items-end mb-2">
                            <div className="flex items-baseline space-x-1">
                                <span className="text-3xl font-black text-gray-900 dark:text-white tracking-tight">
                                    {usedGB}
                                </span>
                                <span className="text-lg font-bold text-gray-400">GB</span>
                                <span className="text-sm font-medium text-gray-400 mx-2">/</span>
                                <span className="text-sm font-bold text-gray-500">{limitGB} GB</span>
                            </div>
                            <div className={`text-sm font-black ${statusText} flex items-center gap-1`}>
                                {data.percentage.toFixed(1)}% <ArrowUpRight className="w-4 h-4" />
                            </div>
                        </div>

                        <div className="relative w-full h-3 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden shadow-inner mb-4">
                            <div
                                className={`absolute top-0 left-0 h-full ${statusColor} rounded-full transition-all duration-1000 ease-out`}
                                style={{ width: `${Math.min(Math.max(data.percentage, 1), 100)}%` }}
                            >
                                <div className="absolute top-0 left-0 w-full h-full bg-white/20 animate-[shimmer_2s_infinite]"></div>
                            </div>
                        </div>

                        {/* Daily bar chart */}
                        {data.daily.length > 0 && (
                            <div className="mt-5">
                                <p className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3">
                                    Consumo Diario — Día por Día
                                </p>
                                <div className="relative">
                                    {/* Tooltip */}
                                    {tooltip && (
                                        <div
                                            className="absolute z-20 pointer-events-none bg-gray-900 text-white text-xs font-bold px-2.5 py-1.5 rounded-xl shadow-lg whitespace-nowrap"
                                            style={{ left: tooltip.x, top: tooltip.y, transform: 'translate(-50%, -110%)' }}
                                        >
                                            Día {tooltip.day}: {formatMB(tooltip.bytes)}
                                        </div>
                                    )}
                                    <div className="flex items-end gap-[2px] w-full" style={{ height: 80 }}>
                                        {data.daily.map(({ day, bytes }) => {
                                            const CHART_H = 80;
                                            const barH = bytes > 0 ? Math.max((bytes / maxDayBytes) * CHART_H, 4) : 2;
                                            const isToday = day === today;
                                            const isFuture = day > today;
                                            const barColor = isToday
                                                ? statusBarColor
                                                : isFuture
                                                    ? 'bg-gray-200/50 dark:bg-gray-700/60'
                                                : bytes > maxDayBytes * 0.7
                                                    ? 'bg-amber-400'
                                                    : 'bg-blue-400/60 dark:bg-blue-500/50';

                                            return (
                                                <div
                                                    key={day}
                                                    className="flex-1 cursor-default group/bar"
                                                    style={{ height: barH }}
                                                    onMouseEnter={(e) => {
                                                        const rect = e.currentTarget.getBoundingClientRect();
                                                        const parentRect = e.currentTarget.closest('.relative').getBoundingClientRect();
                                                        setTooltip({
                                                            day,
                                                            bytes,
                                                            x: rect.left - parentRect.left + rect.width / 2,
                                                            y: rect.top - parentRect.top
                                                        });
                                                    }}
                                                    onMouseLeave={() => setTooltip(null)}
                                                >
                                                    <div
                                                        className={`w-full h-full rounded-t-sm ${barColor} transition-all duration-300 group-hover/bar:brightness-110 opacity-80`}
                                                    />
                                                </div>
                                            );
                                        })}
                                    </div>
                                    {/* Day labels — show every 5 days */}
                                    <div className="flex items-start gap-[2px] mt-1">
                                        {data.daily.map(({ day }) => (
                                            <div key={day} className="flex-1 flex justify-center">
                                                {(day === 1 || day % 5 === 0 || day === today) ? (
                                                    <span className={`text-[9px] font-bold ${day === today ? statusText : 'text-gray-400'}`}>
                                                        {day}
                                                    </span>
                                                ) : null}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}

                        <p className="mt-4 text-xs font-medium text-gray-500 dark:text-gray-400 flex justify-between">
                            <span>{statusMessage}</span>
                            <span className="text-gray-400">{isReconciled ? 'Serie horaria' : 'Cron cada hora'}</span>
                        </p>
                    </div>
                )}
            </div>

            <style jsx>{`
                @keyframes shimmer {
                    0% { transform: translateX(-100%); }
                    100% { transform: translateX(100%); }
                }
            `}</style>
        </div>
    );
};

export default RedisMonitorSettings;
