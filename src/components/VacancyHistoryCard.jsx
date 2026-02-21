import React, { useState, useEffect } from 'react';
import { Eye, CheckCircle2, XCircle, Briefcase, ChevronDown, ChevronUp, Loader2, Clock } from 'lucide-react';
import { formatRelativeDate } from '../utils/formatters';

const VacancyHistoryCard = ({ candidateId }) => {
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(true);
    const [expanded, setExpanded] = useState(false);

    useEffect(() => {
        if (!candidateId) return;

        const fetchHistory = async () => {
            setLoading(true);
            try {
                const res = await fetch(`/api/admin/candidate-history?candidateId=${candidateId}`);
                const data = await res.json();
                if (data.success) {
                    setHistory(data.history || []);
                }
            } catch (err) {
                console.error('Error fetching vacancy history:', err);
            } finally {
                setLoading(false);
            }
        };

        fetchHistory();
    }, [candidateId, expanded]); // Re-fetch on expand to get fresh data

    if (loading && !expanded) return null; // Hide completely until clicked if closed
    if (history.length === 0 && !loading) return null; // Don't show anything if no history

    const renderIcon = (action) => {
        switch (action) {
            case 'SHOWN':
                return <Eye className="w-4 h-4 text-blue-500" />;
            case 'ACCEPTED':
                return <CheckCircle2 className="w-4 h-4 text-green-500" />;
            case 'REJECTED':
                return <XCircle className="w-4 h-4 text-red-500" />;
            default:
                return <Briefcase className="w-4 h-4 text-gray-400" />;
        }
    };

    const renderActionBadge = (action) => {
        switch (action) {
            case 'SHOWN':
                return <span className="text-[9px] font-bold bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 px-1.5 py-0.5 rounded uppercase">Vista</span>;
            case 'ACCEPTED':
                return <span className="text-[9px] font-bold bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 px-1.5 py-0.5 rounded uppercase">Aceptada</span>;
            case 'REJECTED':
                return <span className="text-[9px] font-bold bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300 px-1.5 py-0.5 rounded uppercase">Rechazada</span>;
            default:
                return null;
        }
    };

    return (
        <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 overflow-hidden text-sm">
            <div
                className="flex items-center justify-between p-2.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
                onClick={() => setExpanded(!expanded)}
            >
                <div className="flex items-center space-x-2">
                    <Briefcase className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    <span className="font-semibold text-xs text-gray-800 dark:text-gray-200">
                        Historial de Vacantes ({history.length})
                    </span>
                </div>
                <div className="text-gray-400">
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> :
                        expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </div>
            </div>

            {expanded && (
                <div className="bg-gray-50/50 dark:bg-gray-900/50 p-3 max-h-48 overflow-y-auto border-t border-gray-100 dark:border-gray-750">
                    {loading ? (
                        <div className="flex justify-center py-4">
                            <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
                        </div>
                    ) : history.length === 0 ? (
                        <div className="text-center text-gray-500 text-xs py-2 pb-3">No hay interacciones registradas.</div>
                    ) : (
                        <div className="relative border-l border-gray-200 dark:border-gray-700 ml-2 space-y-4 pb-2">
                            {history.map((event, idx) => (
                                <div key={event.id || idx} className="relative pl-4">
                                    {/* Timeline dot */}
                                    <div className="absolute -left-2.5 top-1 bg-white dark:bg-gray-800 rounded-full p-0.5 border border-gray-200 dark:border-gray-700 shadow-sm">
                                        {renderIcon(event.action)}
                                    </div>

                                    <div className="flex flex-col">
                                        <div className="flex items-center justify-between">
                                            <span className="font-bold text-xs text-gray-900 dark:text-white truncate">
                                                {event.projectName || 'Proyecto'}
                                            </span>
                                            {renderActionBadge(event.action)}
                                        </div>

                                        {event.reason && event.reason !== 'Motivo no especificado' && (
                                            <p className="text-[10px] text-gray-600 dark:text-gray-300 mt-0.5 bg-white dark:bg-gray-800 p-1 rounded-md border border-gray-100 dark:border-gray-700 italic">
                                                "{event.reason}"
                                            </p>
                                        )}

                                        <div className="flex flex-row items-center space-x-1 mt-1 text-gray-400 dark:text-gray-500">
                                            <Clock className="w-3 h-3" />
                                            <span className="text-[9px]">{formatRelativeDate(new Date(event.timestamp))}</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default VacancyHistoryCard;
