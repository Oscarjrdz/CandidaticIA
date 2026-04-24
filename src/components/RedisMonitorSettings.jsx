import React, { useState, useEffect } from 'react';
import { Activity, Server, ArrowUpRight, AlertTriangle, ShieldCheck } from 'lucide-react';

const RedisMonitorSettings = () => {
    const [data, setData] = useState({ usedBytes: 0, limitBytes: 107374182400, percentage: 0 });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    useEffect(() => {
        const fetchBandwidth = async () => {
            try {
                const res = await fetch('/api/system/bandwidth');
                if (!res.ok) throw new Error('API Error');
                const result = await res.json();
                if (result.success) {
                    setData({
                        usedBytes: result.usedBytes || 0,
                        limitBytes: result.limitBytes || 107374182400,
                        percentage: result.percentage || 0
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

    const formatGB = (bytes) => {
        return (bytes / (1024 * 1024 * 1024)).toFixed(2);
    };

    const usedGB = formatGB(data.usedBytes);
    const limitGB = formatGB(data.limitBytes);
    
    // Aesthetic logic
    let statusColor = 'bg-emerald-500';
    let statusText = 'text-emerald-500';
    let statusBg = 'bg-emerald-50';
    let statusIcon = <ShieldCheck className="w-5 h-5 text-emerald-500" />;
    let statusMessage = "Sistema Operando Óptimamente";

    if (data.percentage > 85) {
        statusColor = 'bg-red-500';
        statusText = 'text-red-600';
        statusBg = 'bg-red-50';
        statusIcon = <AlertTriangle className="w-5 h-5 text-red-500" />;
        statusMessage = "Peligro: Límite de Ancho de Banda Cercano";
    } else if (data.percentage > 60) {
        statusColor = 'bg-amber-400';
        statusText = 'text-amber-600';
        statusBg = 'bg-amber-50';
        statusIcon = <Activity className="w-5 h-5 text-amber-500" />;
        statusMessage = "Advertencia: Consumo Elevado";
    }

    if (loading) {
        return (
            <div className="bg-white dark:bg-gray-800 rounded-3xl p-6 border border-gray-100 dark:border-gray-700 shadow-sm animate-pulse h-48">
                <div className="flex items-center space-x-3 mb-6">
                    <div className="w-10 h-10 bg-gray-200 dark:bg-gray-700 rounded-xl"></div>
                    <div className="h-6 w-48 bg-gray-200 dark:bg-gray-700 rounded-md"></div>
                </div>
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded-full mb-3"></div>
                <div className="h-3 w-1/3 bg-gray-200 dark:bg-gray-700 rounded-md"></div>
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
                                <span className={`text-[10px] uppercase font-black px-2 py-0.5 rounded-full ${statusBg} ${statusText} tracking-wider`}>
                                    Live
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

                        {/* Progress Bar Container */}
                        <div className="relative w-full h-3 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden shadow-inner">
                            {/* Animated Fill */}
                            <div 
                                className={`absolute top-0 left-0 h-full ${statusColor} rounded-full transition-all duration-1000 ease-out`}
                                style={{ width: `${Math.min(Math.max(data.percentage, 1), 100)}%` }}
                            >
                                {/* Shine Effect */}
                                <div className="absolute top-0 left-0 w-full h-full bg-white/20 animate-[shimmer_2s_infinite]"></div>
                            </div>
                        </div>

                        <p className="mt-4 text-xs font-medium text-gray-500 dark:text-gray-400 flex justify-between">
                            <span>{statusMessage}</span>
                            <span className="text-gray-400">Se actualiza cada 60 mins</span>
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
