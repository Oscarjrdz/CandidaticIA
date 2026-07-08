import React, { useEffect, useState } from 'react';
import { History, RefreshCw, RotateCcw, Save, Sparkles, Wand2 } from 'lucide-react';
import Card from '../ui/Card';
import Button from '../ui/Button';
import Skeleton from '../ui/Skeleton';
import { getSessionToken } from './session';
import { useToastContext } from '../../contexts/ToastContext';

const MAX_STYLE_GUIDE_CHARS = 20000;
const DEFAULT_TAG = 'KATCON ANUNCIO';

const PersonaPanel = () => {
    const { showToast } = useToastContext();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [styleGuide, setStyleGuide] = useState('');
    const [version, setVersion] = useState(0);
    const [updatedAt, setUpdatedAt] = useState(null);
    const [history, setHistory] = useState([]);
    const [showHistory, setShowHistory] = useState(false);
    const [availableTags, setAvailableTags] = useState([]);
    const [tokensToday, setTokensToday] = useState(0);

    const [selectedTag, setSelectedTag] = useState(DEFAULT_TAG);
    const [maxCandidates, setMaxCandidates] = useState(100);
    const [resyncing, setResyncing] = useState(false);
    const [proposal, setProposal] = useState(null);
    const [resyncStats, setResyncStats] = useState(null);

    const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${getSessionToken()}` };

    const loadPersona = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/brenda-training/persona', { headers: authHeaders });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo cargar la personalidad');

            setStyleGuide(data.persona?.styleGuide || '');
            setVersion(data.persona?.version || 0);
            setUpdatedAt(data.persona?.updatedAt || null);
            setHistory(data.history || []);
            setAvailableTags(data.availableTags || []);
            setTokensToday(data.tokensToday || 0);
            if ((data.availableTags || []).some(t => (typeof t === 'string' ? t : t?.name) === DEFAULT_TAG)) {
                setSelectedTag(DEFAULT_TAG);
            } else if (data.availableTags?.[0]) {
                setSelectedTag(typeof data.availableTags[0] === 'string' ? data.availableTags[0] : data.availableTags[0].name);
            }
        } catch (error) {
            showToast(error.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadPersona();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleSave = async () => {
        if (!styleGuide.trim() || saving) return;
        setSaving(true);
        try {
            const res = await fetch('/api/brenda-training/persona', {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({ styleGuide: styleGuide.slice(0, MAX_STYLE_GUIDE_CHARS) })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo guardar');

            setVersion(data.persona.version);
            setUpdatedAt(data.persona.updatedAt);
            showToast(`Personalidad guardada (v${data.persona.version})`, 'success');
            loadPersona();
        } catch (error) {
            showToast(error.message, 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleRestore = async (targetVersion) => {
        try {
            const res = await fetch('/api/brenda-training/persona', {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({ restoreVersion: targetVersion })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo restaurar');

            setStyleGuide(data.persona.styleGuide);
            setVersion(data.persona.version);
            setUpdatedAt(data.persona.updatedAt);
            showToast(`Version v${targetVersion} restaurada como v${data.persona.version}`, 'success');
            loadPersona();
        } catch (error) {
            showToast(error.message, 'error');
        }
    };

    const handleResync = async () => {
        setResyncing(true);
        setProposal(null);
        try {
            const res = await fetch('/api/brenda-training/resync', {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({ tag: selectedTag, maxCandidates: Number(maxCandidates) || 100 })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo generar la propuesta');

            if (!data.proposedStyleGuide) {
                showToast(data.message || 'No se encontraron mensajes para ese tag', 'warning');
            } else {
                setProposal(data.proposedStyleGuide);
                setResyncStats(data.stats);
            }
            setTokensToday((prev) => prev + (data.usage?.total_tokens || 0));
        } catch (error) {
            showToast(error.message, 'error');
        } finally {
            setResyncing(false);
        }
    };

    return (
        <div className="h-[560px] overflow-y-auto">
            <Card
                title="Personalidad"
                icon={Sparkles}
                className="border-gray-100 dark:border-gray-700"
                actions={
                    <span className="text-[10px] font-semibold text-gray-400 dark:text-gray-500">
                        v{version} {updatedAt ? `· ${new Date(updatedAt).toLocaleString('es-MX', { timeZone: 'America/Monterrey' })}` : ''}
                    </span>
                }
            >
                <div className="space-y-4">
                    <div className="flex items-center justify-between text-[11px] text-gray-400 dark:text-gray-500">
                        <span>Tokens usados hoy en entrenamiento: <strong className="text-gray-600 dark:text-gray-300">{tokensToday}</strong></span>
                        <button onClick={loadPersona} className="flex items-center gap-1 hover:text-blue-600 dark:hover:text-blue-400">
                            <RefreshCw className="w-3 h-3" /> Recargar
                        </button>
                    </div>

                    {loading ? (
                        <Skeleton className="w-full h-64 rounded-2xl" />
                    ) : (
                        <textarea
                            value={styleGuide}
                            onChange={(e) => setStyleGuide(e.target.value.slice(0, MAX_STYLE_GUIDE_CHARS))}
                            placeholder="Aqui va la guia de estilo de Brenda (tono, tacticas, plantillas de cierre)..."
                            className="w-full h-64 p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/30 dark:bg-gray-900/40 text-gray-800 dark:text-gray-200 focus:ring-2 focus:ring-blue-500 text-xs resize-none leading-relaxed font-mono"
                        />
                    )}

                    <div className="flex justify-between items-center">
                        <button
                            onClick={() => setShowHistory((v) => !v)}
                            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                        >
                            <History className="w-3.5 h-3.5" /> Historial ({history.length})
                        </button>
                        <Button onClick={handleSave} loading={saving} size="sm">
                            <Save className="w-4 h-4 mr-2" /> Guardar
                        </Button>
                    </div>

                    {showHistory && (
                        <div className="border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-700 max-h-40 overflow-y-auto">
                            {history.length === 0 ? (
                                <p className="text-xs text-gray-400 p-3">Sin versiones anteriores todavia.</p>
                            ) : (
                                history.map((h) => (
                                    <div key={h.version} className="flex items-center justify-between px-3 py-2 text-xs">
                                        <span className="text-gray-500 dark:text-gray-400">
                                            v{h.version} · {new Date(h.updatedAt).toLocaleDateString('es-MX', { timeZone: 'America/Monterrey' })}
                                        </span>
                                        <button
                                            onClick={() => handleRestore(h.version)}
                                            className="flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline"
                                        >
                                            <RotateCcw className="w-3 h-3" /> Restaurar
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                    )}

                    <div className="border-t border-gray-100 dark:border-gray-700 pt-4 space-y-3">
                        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                            Actualizar con chats leídos
                        </p>
                        <div className="flex gap-2">
                            <select
                                value={selectedTag}
                                onChange={(e) => setSelectedTag(e.target.value)}
                                className="flex-1 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-2 py-1.5 text-gray-800 dark:text-gray-200"
                            >
                                {availableTags.length === 0 && <option value={DEFAULT_TAG}>{DEFAULT_TAG}</option>}
                                {availableTags.map((t) => {
                                    const name = typeof t === 'string' ? t : t?.name;
                                    return <option key={name} value={name}>{name}</option>;
                                })}
                            </select>
                            <input
                                type="number"
                                min={1}
                                max={300}
                                value={maxCandidates}
                                onChange={(e) => setMaxCandidates(e.target.value)}
                                className="w-20 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-2 py-1.5 text-gray-800 dark:text-gray-200"
                                title="Maximo de candidatos a leer"
                            />
                        </div>
                        <Button onClick={handleResync} loading={resyncing} variant="secondary" size="sm" className="w-full">
                            <Wand2 className="w-4 h-4 mr-2" /> Generar propuesta desde chats
                        </Button>

                        {resyncStats && (
                            <p className="text-[10px] text-gray-400 dark:text-gray-500">
                                {resyncStats.candidatesMatched} candidatos con ese tag · {resyncStats.candidatesSampled} leidos · {resyncStats.uniqueExchangesUsed} respuestas unicas usadas
                            </p>
                        )}

                        {proposal && (
                            <div className="space-y-2">
                                <textarea
                                    readOnly
                                    value={proposal}
                                    className="w-full h-40 p-3 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50/40 dark:bg-amber-900/10 text-gray-800 dark:text-gray-200 text-xs resize-none leading-relaxed font-mono"
                                />
                                <div className="flex gap-2">
                                    <Button
                                        onClick={() => { setStyleGuide(proposal); setProposal(null); }}
                                        size="sm"
                                        className="flex-1"
                                    >
                                        Usar esta version (sin guardar)
                                    </Button>
                                    <Button onClick={() => setProposal(null)} variant="outline" size="sm">
                                        Descartar
                                    </Button>
                                </div>
                                <p className="text-[10px] text-gray-400 dark:text-gray-500">
                                    Esto solo llena el editor de arriba — dale "Guardar" para que quede activa.
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </Card>
        </div>
    );
};

export default PersonaPanel;
