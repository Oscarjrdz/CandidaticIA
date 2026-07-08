import React, { useEffect, useRef, useState } from 'react';
import { GraduationCap, Loader2, Plus, Trash2 } from 'lucide-react';
import TrainingBubble from './TrainingBubble';
import { getSessionToken } from './session';
import { useToastContext } from '../../contexts/ToastContext';

const MAX_TEXT_CHARS = 1500;

const ChatTrainingPanel = () => {
    const { showToast } = useToastContext();
    const [examples, setExamples] = useState([]);
    const [loadingList, setLoadingList] = useState(true);
    const [candidateSaid, setCandidateSaid] = useState('');
    const [recruiterSaid, setRecruiterSaid] = useState('');
    const [saving, setSaving] = useState(false);
    const endRef = useRef(null);

    const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${getSessionToken()}` };

    const loadExamples = async () => {
        setLoadingList(true);
        try {
            const res = await fetch('/api/brenda-training/examples', { headers: authHeaders });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'No se pudieron cargar los ejemplos');
            setExamples(data.examples || []);
        } catch (error) {
            showToast(error.message, 'error');
        } finally {
            setLoadingList(false);
        }
    };

    useEffect(() => {
        loadExamples();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, [examples]);

    const handleAdd = async () => {
        const cs = candidateSaid.trim().slice(0, MAX_TEXT_CHARS);
        const rs = recruiterSaid.trim().slice(0, MAX_TEXT_CHARS);
        if (!cs || !rs || saving) return;

        setSaving(true);
        try {
            const res = await fetch('/api/brenda-training/examples', {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({ candidateSaid: cs, recruiterSaid: rs })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo agregar el ejemplo');

            setExamples((prev) => [data.example, ...prev]);
            setCandidateSaid('');
            setRecruiterSaid('');
            showToast('Ejemplo agregado a la personalidad', 'success');
        } catch (error) {
            showToast(error.message, 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleRemove = async (id) => {
        try {
            const res = await fetch('/api/brenda-training/examples', {
                method: 'DELETE',
                headers: authHeaders,
                body: JSON.stringify({ id })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo quitar el ejemplo');
            setExamples((prev) => prev.filter((e) => e.id !== id));
        } catch (error) {
            showToast(error.message, 'error');
        }
    };

    return (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg flex flex-col h-[560px]">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                        <GraduationCap className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                    </div>
                    <h3 className="font-semibold text-gray-900 dark:text-white text-sm">Chat Brenda training</h3>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Enseña con ejemplos: escribe lo que dijo el candidato y cómo debiste responder tú. No usa GPT — cero costo.
                </p>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-gray-50 dark:bg-gray-950">
                {loadingList ? (
                    <p className="text-xs text-gray-400 text-center pt-6">Cargando ejemplos...</p>
                ) : examples.length === 0 ? (
                    <p className="text-xs text-gray-400 dark:text-gray-500 text-center pt-6">
                        Todavia no hay ejemplos enseñados. Agrega el primero abajo.
                    </p>
                ) : (
                    [...examples].reverse().map((ex) => (
                        <div key={ex.id} className="group space-y-1.5">
                            <TrainingBubble role="assistant">{ex.candidateSaid}</TrainingBubble>
                            <div className="flex items-center justify-end gap-2">
                                <button
                                    onClick={() => handleRemove(ex.id)}
                                    className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-red-500"
                                    title="Quitar ejemplo"
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                </button>
                                <div className="flex-1">
                                    <TrainingBubble role="user">{ex.recruiterSaid}</TrainingBubble>
                                </div>
                            </div>
                        </div>
                    ))
                )}
                <div ref={endRef} />
            </div>

            <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 space-y-2">
                <textarea
                    value={candidateSaid}
                    onChange={(e) => setCandidateSaid(e.target.value.slice(0, MAX_TEXT_CHARS))}
                    placeholder="Candidato dice..."
                    rows={2}
                    className="w-full resize-none rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white outline-none focus:border-amber-500"
                />
                <textarea
                    value={recruiterSaid}
                    onChange={(e) => setRecruiterSaid(e.target.value.slice(0, MAX_TEXT_CHARS))}
                    placeholder="Tú respondes como Brenda..."
                    rows={2}
                    className="w-full resize-none rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white outline-none focus:border-amber-500"
                />
                <button
                    onClick={handleAdd}
                    disabled={saving || !candidateSaid.trim() || !recruiterSaid.trim()}
                    className="w-full flex items-center justify-center gap-2 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-sm font-semibold py-2 transition-colors"
                >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Agregar a personalidad
                </button>
            </div>
        </div>
    );
};

export default ChatTrainingPanel;
