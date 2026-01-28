import React, { useState, useEffect } from 'react';
import {
    Send, Users, MessageSquare, CheckSquare, Square,
    Loader2, AlertCircle, Plus, Calendar, Clock,
    Trash2, RefreshCw, Filter, ChevronRight, Check, Pencil, Play, Tag, Copy, Eye, Sparkles
} from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';
import Modal from './ui/Modal';
import { getCandidates } from '../services/candidatesService';

const BulksSection = ({ showToast }) => {
    // Campaigns state
    const [campaigns, setCampaigns] = useState([]);
    const [stats, setStats] = useState({ pending: 0, sending: 0, completed: 0 });
    const [loading, setLoading] = useState(false);

    // UI state
    const [view, setView] = useState('list'); // 'list' or 'create'
    const [step, setStep] = useState(1);

    // Wizard state
    const [newCampaign, setNewCampaign] = useState({
        name: '',
        messages: [''],
        delaySeconds: 30,
        scheduledAt: new Date().toISOString().slice(0, 16),
        filters: {
            field: '',
            operator: 'empty', // 'empty' or 'equals'
            value: ''
        },
        recipients: []
    });

    // Candidates cache for filtering
    const [allCandidates, setAllCandidates] = useState([]);
    const [filteredCandidates, setFilteredCandidates] = useState([]);
    const [lastActiveInput, setLastActiveInput] = useState(null);
    const [previewCandidate, setPreviewCandidate] = useState(null);
    const [availableFields, setAvailableFields] = useState([]);
    const [isManualSelection, setIsManualSelection] = useState(false);

    // Update preview candidate when filtered list changes
    useEffect(() => {
        if (filteredCandidates.length > 0 && !previewCandidate) {
            setPreviewCandidate(filteredCandidates[0]);
        } else if (filteredCandidates.length === 0) {
            setPreviewCandidate(null);
        }
    }, [filteredCandidates]);

    const substituteVariables = (text, candidate) => {
        if (!candidate || !text) return text;
        let result = text;

        // Standard fields
        result = result.replace(/{{nombre}}/g, candidate.nombre || 'Candidato');
        result = result.replace(/{{whatsapp}}/g, candidate.whatsapp || '');

        // Dynamic fields from availableFields
        availableFields.forEach(field => {
            const regex = new RegExp(`{{${field.value}}}`, 'g');
            result = result.replace(regex, candidate[field.value] || 'N/A');
        });

        return result;
    };

    const cyclePreviewCandidate = () => {
        if (filteredCandidates.length <= 1) return;
        const currentIndex = filteredCandidates.indexOf(previewCandidate);
        const nextIndex = (currentIndex + 1) % filteredCandidates.length;
        setPreviewCandidate(filteredCandidates[nextIndex]);
    };

    const availableTags = [
        { label: 'Nombre', value: '{{nombre}}' },
        { label: 'WhatsApp', value: '{{whatsapp}}' },
        ...availableFields.map(f => ({ label: f.label, value: `{{${f.value}}}` }))
    ];

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
        showToast(`Copiado: ${text}`, 'success');
    };

    const handleTagClick = (tagValue) => {
        copyToClipboard(tagValue);

        if (lastActiveInput !== null) {
            const newMsgs = [...newCampaign.messages];
            const currentText = newMsgs[lastActiveInput];
            newMsgs[lastActiveInput] = currentText + tagValue;
            setNewCampaign({ ...newCampaign, messages: newMsgs });
            showToast(`Insertado: ${tagValue}`, 'success');
        }
    };

    useEffect(() => {
        loadCampaigns();
        loadAllCandidates();
        loadFields();

        // Check for AI Draft
        const draftMsg = localStorage.getItem('draft_bulk_message');
        const draftIds = localStorage.getItem('draft_bulk_ids');

        if (draftMsg) {
            let recipients = [];
            let manualMode = false;

            if (draftIds) {
                try {
                    const ids = JSON.parse(draftIds);
                    if (Array.isArray(ids) && ids.length > 0) {
                        recipients = ids; // We store IDs, but state needs checking against allCandidates? 
                        // Actually recipients state stores IDs.
                        manualMode = true;
                    }
                } catch (e) {
                    console.error('Error parsing draft ids', e);
                }
            }

            setNewCampaign(prev => ({
                ...prev,
                messages: [draftMsg],
                name: 'Campaña Sugerida por IA',
                recipients: manualMode ? recipients : prev.recipients
            }));

            if (manualMode) {
                setIsManualSelection(true);
                // We need to wait for allCandidates to load to set filteredCandidates properly
                // But we can set a flag to do it in the candidates effect
            }

            setView('create');
            setStep(3); // Jump straight to content

            // Clear draft
            localStorage.removeItem('draft_bulk_message');
            localStorage.removeItem('draft_bulk_ids');
            showToast(manualMode ? 'Borrador y destinatarios cargados' : 'Borrador de IA cargado', 'success');
        }
    }, []);

    const loadCampaigns = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/bulks');
            const data = await res.json();
            if (data.success) {
                setCampaigns(data.bulks);
                updateStats(data.bulks);
            }
        } catch (error) {
            showToast('Error cargando campañas', 'error');
        } finally {
            setLoading(false);
        }
    };

    const updateStats = (list) => {
        const s = { pending: 0, sending: 0, completed: 0 };
        list.forEach(c => {
            if (c.status === 'pending') s.pending++;
            else if (c.status === 'sending') s.sending++;
            else if (c.status === 'completed') s.completed++;
        });
        setStats(s);
    };

    const loadAllCandidates = async () => {
        const result = await getCandidates(1000, 0);
        if (result.success) setAllCandidates(result.candidates);
    };

    const loadFields = async () => {
        try {
            const res = await fetch('/api/fields');
            const data = await res.json();
            if (data.success) {
                setAvailableFields(data.fields || []);
            }
        } catch (e) {
            console.error('Error loading fields:', e);
        }
    };

    // Filtering Logic
    // Filtering Logic & Manual Mode Sync
    useEffect(() => {
        // If we are in manual selection mode, we verify the IDs against allCandidates to show the preview
        if (isManualSelection) {
            if (allCandidates.length > 0 && newCampaign.recipients.length > 0) {
                const manualSubset = allCandidates.filter(c => newCampaign.recipients.includes(c.id));
                setFilteredCandidates(manualSubset);
            }
            return;
        }

        const { field, operator, value } = newCampaign.filters;
        let list = [...allCandidates];

        if (field) {
            if (operator === 'empty') {
                list = list.filter(c => !c[field] || c[field] === '-' || c[field] === '');
            } else if (operator === 'equals' && value) {
                list = list.filter(c => String(c[field]).toLowerCase().includes(value.toLowerCase()));
            }
        }

        setFilteredCandidates(list);
        setNewCampaign(prev => ({ ...prev, recipients: list.map(c => c.id) }));
    }, [newCampaign.filters, allCandidates, isManualSelection, newCampaign.recipients]);

    const handleCreateCampaign = async () => {
        if (!newCampaign.name || newCampaign.messages.filter(m => m.trim()).length === 0) {
            showToast('Completa los campos obligatorios', 'warning');
            return;
        }

        const isEditing = !!newCampaign.id;

        // CONVERTIR A ISO UTC ANTES DE ENVIAR (Crucial para el servidor)
        const scheduledAtISO = new Date(newCampaign.scheduledAt).toISOString();

        try {
            const res = await fetch('/api/bulks', {
                method: isEditing ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...newCampaign,
                    scheduledAt: scheduledAtISO,
                    messages: newCampaign.messages.filter(m => m.trim())
                })
            });

            if (res.ok) {
                showToast(isEditing ? 'Campaña actualizada' : 'Campaña creada y programada', 'success');
                setView('list');
                loadCampaigns();
                // Reset form
                setStep(1);
                setNewCampaign({
                    name: '',
                    messages: [''],
                    delaySeconds: 30,
                    scheduledAt: new Date().toISOString().slice(0, 16),
                    filters: { field: '', operator: 'empty', value: '' },
                    recipients: []
                });
            }
        } catch (error) {
            showToast('Error al procesar campaña', 'error');
        }
    };


    const handleEditCampaign = (campaign) => {
        // Convertir de UTC a LOCAL para el input datetime-local
        const d = new Date(campaign.scheduledAt);
        const z = d.getTimezoneOffset() * 60 * 1000;
        const localDate = new Date(d - z);
        const formatted = localDate.toISOString().slice(0, 16);

        setNewCampaign({
            ...campaign,
            scheduledAt: formatted
        });
        setStep(1);
        setView('create');
    };

    const handleDeleteCampaign = async (id) => {
        if (!window.confirm('¿Eliminar esta campaña?')) return;
        try {
            await fetch(`/api/bulks?id=${id}`, { method: 'DELETE' });
            loadCampaigns();
        } catch (e) {
            showToast('Error al eliminar', 'error');
        }
    };

    // Render Components
    const StatCard = ({ label, value, color }) => (
        <div className={`p-4 rounded-xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm flex items-center justify-between`}>
            <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">{label}</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{value}</p>
            </div>
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}>
                <Filter className="w-5 h-5 text-white" />
            </div>
        </div>
    );

    if (view === 'create') {
        const isEditing = !!newCampaign.id;
        return (
            <div className="max-w-4xl mx-auto space-y-6">
                <div className="flex items-center justify-between">
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                        {isEditing ? 'Editar Campaña' : 'Nueva Campaña Inteligente'}
                    </h2>
                    <Button variant="outline" onClick={() => setView('list')}>Cancelar</Button>
                </div>

                {/* Steps indicator */}
                <div className="flex items-center space-x-4 mb-8">
                    {[1, 2, 3].map(s => (
                        <div key={s} className="flex items-center">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${step >= s ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
                                {s}
                            </div>
                            {s < 3 && <div className={`w-12 h-0.5 ${step > s ? 'bg-blue-600' : 'bg-gray-200'}`} />}
                        </div>
                    ))}
                </div>

                <Card>
                    <div className="p-6">
                        {step === 1 && (
                            <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                                <h3 className="text-lg font-semibold border-b pb-2">Configuración Básica</h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">Nombre de la Campaña</label>
                                        <input
                                            className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700"
                                            placeholder="Ej: Seguimiento Vacante IT"
                                            value={newCampaign.name}
                                            onChange={e => setNewCampaign({ ...newCampaign, name: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">Programación</label>
                                        <input
                                            type="datetime-local"
                                            className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700"
                                            value={newCampaign.scheduledAt}
                                            onChange={e => setNewCampaign({ ...newCampaign, scheduledAt: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium flex items-center justify-between">
                                            Delay entre mensajes (segundos)
                                            <span className="text-xs text-blue-600 font-bold">{newCampaign.delaySeconds}s</span>
                                        </label>
                                        <input
                                            type="range" min="5" max="300" step="5"
                                            className="w-full"
                                            value={newCampaign.delaySeconds}
                                            onChange={e => setNewCampaign({ ...newCampaign, delaySeconds: parseInt(e.target.value) })}
                                        />
                                    </div>
                                </div>
                                <div className="flex justify-end pt-4">
                                    <Button onClick={() => setStep(2)} icon={ChevronRight}>Siguiente: Filtros</Button>
                                </div>
                            </div>
                        )}

                        {step === 2 && (
                            <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                                <h3 className="text-lg font-semibold border-b pb-2">Destinatarios</h3>

                                {isManualSelection ? (
                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between bg-blue-50 dark:bg-blue-900/20 p-4 rounded-xl border border-blue-200 dark:border-blue-800">
                                            <div className="flex items-center space-x-3">
                                                <div className="w-10 h-10 bg-blue-100 dark:bg-blue-800 rounded-full flex items-center justify-center">
                                                    <Sparkles className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                                                </div>
                                                <div>
                                                    <h4 className="font-bold text-gray-900 dark:text-white">Selección Manual por IA</h4>
                                                    <p className="text-sm text-gray-600 dark:text-gray-300">
                                                        Se han seleccionado <strong>{filteredCandidates.length} candidatos</strong> específicos.
                                                    </p>
                                                </div>
                                            </div>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => {
                                                    if (window.confirm('¿Quieres descartar esta selección y usar filtros manuales?')) {
                                                        setIsManualSelection(false);
                                                        setNewCampaign(prev => ({ ...prev, recipients: [] }));
                                                    }
                                                }}
                                            >
                                                Descartar y Filtrar Manualmente
                                            </Button>
                                        </div>

                                        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                                            <div className="overflow-y-auto max-h-[300px]">
                                                <table className="w-full text-left text-sm">
                                                    <thead className="bg-gray-50 dark:bg-gray-800 sticky top-0 z-10">
                                                        <tr>
                                                            <th className="py-3 px-4 font-semibold text-gray-700 dark:text-gray-300">Candidato</th>
                                                            <th className="py-3 px-4 font-semibold text-gray-700 dark:text-gray-300">Teléfono</th>
                                                            <th className="py-3 px-4 font-semibold text-gray-700 dark:text-gray-300">Categoría</th>
                                                            <th className="py-3 px-4 font-semibold text-gray-700 dark:text-gray-300 w-10"></th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                                        {filteredCandidates.map(c => (
                                                            <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                                                                <td className="py-2 px-4">
                                                                    <p className="font-medium text-gray-900 dark:text-white">{c.nombre || c.nombreReal || 'Sin nombre'}</p>
                                                                    <p className="text-xs text-gray-500">{c.municipio || '-'}</p>
                                                                </td>
                                                                <td className="py-2 px-4 text-gray-600 dark:text-gray-300 font-mono text-xs">{c.telefono}</td>
                                                                <td className="py-2 px-4 text-gray-600 dark:text-gray-300 text-xs">
                                                                    <span className="bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full">
                                                                        {c.categoria || 'General'}
                                                                    </span>
                                                                </td>
                                                                <td className="py-2 px-4 text-right">
                                                                    <button
                                                                        onClick={() => {
                                                                            const newList = filteredCandidates.filter(can => can.id !== c.id);
                                                                            setFilteredCandidates(newList);
                                                                            setNewCampaign(prev => ({
                                                                                ...prev,
                                                                                recipients: prev.recipients.filter(id => id !== c.id)
                                                                            }));
                                                                        }}
                                                                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg smooth-transition"
                                                                        title="Quitar de la lista"
                                                                    >
                                                                        <Trash2 className="w-4 h-4" />
                                                                    </button>
                                                                </td>
                                                            </tr>
                                                        ))}
                                                        {filteredCandidates.length === 0 && (
                                                            <tr>
                                                                <td colSpan="4" className="py-8 text-center text-gray-500">
                                                                    No quedan candidatos seleccionados.
                                                                </td>
                                                            </tr>
                                                        )}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-gray-50 dark:bg-gray-900/50 p-4 rounded-xl border border-dashed border-gray-300">
                                        <div className="space-y-2">
                                            <label className="text-xs font-bold uppercase text-gray-500">Columna/Campo</label>
                                            <select
                                                className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700"
                                                value={newCampaign.filters.field}
                                                onChange={e => setNewCampaign({ ...newCampaign, filters: { ...newCampaign.filters, field: e.target.value } })}
                                            >
                                                <option value="">Selecciona un campo...</option>
                                                <option value="municipio">Municipio</option>
                                                <option value="categoria">Categoría</option>
                                                <option value="fechaNacimiento">Fecha Nacimiento</option>
                                                <option value="nombreReal">Nombre Real</option>
                                                {availableFields.map(f => (
                                                    <option key={f.id} value={f.name}>{f.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-xs font-bold uppercase text-gray-500">Condición</label>
                                            <select
                                                className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700"
                                                value={newCampaign.filters.operator}
                                                onChange={e => setNewCampaign({ ...newCampaign, filters: { ...newCampaign.filters, operator: e.target.value } })}
                                            >
                                                <option value="empty">Está vacío / falta dato</option>
                                                <option value="equals">Contiene texto...</option>
                                            </select>
                                        </div>
                                        {newCampaign.filters.operator === 'equals' && (
                                            <div className="space-y-2">
                                                <label className="text-xs font-bold uppercase text-gray-500">Valor a buscar</label>
                                                <input
                                                    className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700"
                                                    placeholder="Texto a filtrar..."
                                                    value={newCampaign.filters.value}
                                                    onChange={e => setNewCampaign({ ...newCampaign, filters: { ...newCampaign.filters, value: e.target.value } })}
                                                />
                                            </div>
                                        )}
                                    </div>
                                )}

                                <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg flex items-center justify-between">
                                    <div className="flex items-center space-x-2">
                                        <Users className="w-5 h-5 text-blue-600" />
                                        <span className="font-bold text-blue-700 dark:text-blue-300">
                                            {filteredCandidates.length} candidatos coinciden
                                        </span>
                                    </div>
                                    <p className="text-xs text-blue-600">Basado en tu base de datos actual</p>
                                </div>

                                <div className="flex justify-between pt-4">
                                    <Button variant="outline" onClick={() => setStep(1)}>Atrás</Button>
                                    <Button onClick={() => setStep(3)} icon={ChevronRight}>Siguiente: Redactar y Programar</Button>
                                </div>
                            </div>
                        )}

                        {step === 3 && (
                            <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                                <div className="flex items-center justify-between border-b pb-2">
                                    <h3 className="text-lg font-semibold">Variaciones de Mensaje (Anti-Bloqueo)</h3>
                                    <Button size="sm" variant="outline" icon={Plus} onClick={() => setNewCampaign({ ...newCampaign, messages: [...newCampaign.messages, ''] })}>
                                        Agregar Variante
                                    </Button>
                                </div>

                                <div className="space-y-3">
                                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center space-x-2">
                                        <Tag className="w-4 h-4" />
                                        <span>Etiquetas dinámicas (Haz clic para copiar):</span>
                                    </label>
                                    <div className="flex flex-wrap gap-2">
                                        {availableTags.map(tag => (
                                            <button
                                                key={tag.value}
                                                onClick={() => handleTagClick(tag.value)}
                                                className="px-3 py-1.5 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-lg text-xs font-medium border border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/50 flex items-center space-x-1.5 group smooth-transition"
                                            >
                                                <span>{tag.label}</span>
                                                <code className="bg-blue-100 dark:bg-blue-800 px-1 rounded opacity-70 group-hover:opacity-100">{tag.value}</code>
                                                <Copy className="w-3 h-3 opacity-0 group-hover:opacity-100" />
                                            </button>
                                        ))}
                                    </div>
                                    <p className="text-[10px] text-gray-400 italic">Haz clic en cualquier etiqueta y pégala en tu mensaje.</p>
                                </div>

                                <div className="space-y-4">
                                    {newCampaign.messages.map((m, idx) => (
                                        <div key={idx} className="relative group">
                                            <textarea
                                                className="w-full h-24 px-3 py-2 border rounded-lg dark:bg-gray-700 pr-10 focus:ring-2 focus:ring-gray-200 dark:focus:ring-gray-700/50"
                                                placeholder={`Variante ${idx + 1}: Hola {{nombre}}, ¿cómo estás?`}
                                                value={m}
                                                onFocus={() => setLastActiveInput(idx)}
                                                onChange={e => {
                                                    const newMsgs = [...newCampaign.messages];
                                                    newMsgs[idx] = e.target.value;
                                                    setNewCampaign({ ...newCampaign, messages: newMsgs });
                                                }}
                                            />
                                            {newCampaign.messages.length > 1 && (
                                                <button
                                                    onClick={() => {
                                                        const newMsgs = newCampaign.messages.filter((_, i) => i !== idx);
                                                        setNewCampaign({ ...newCampaign, messages: newMsgs });
                                                    }}
                                                    className="absolute top-2 right-2 p-1 text-red-500 opacity-0 group-hover:opacity-100 smooth-transition"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </div>

                                {/* Live Preview Section */}
                                {previewCandidate && (
                                    <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700">
                                        <div className="flex items-center justify-between mb-3">
                                            <div className="flex items-center space-x-2">
                                                <Eye className="w-4 h-4 text-blue-500" />
                                                <span className="text-sm font-bold text-gray-700 dark:text-gray-300">Vista Previa Real</span>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={cyclePreviewCandidate}
                                                className="text-[10px] text-blue-600 hover:underline flex items-center"
                                            >
                                                <RefreshCw className="w-3 h-3 mr-1" /> Ver con otro candidato
                                            </button>
                                        </div>
                                        <div className="bg-white dark:bg-gray-900 p-4 rounded-lg border border-gray-100 dark:border-gray-800 shadow-inner">
                                            <div className="flex items-center space-x-2 mb-2">
                                                <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center text-[10px] font-bold text-blue-600 uppercase">
                                                    {previewCandidate.nombre?.charAt(0) || 'C'}
                                                </div>
                                                <span className="text-xs font-medium text-gray-500">Para: {previewCandidate.nombre || 'Candidato'}</span>
                                            </div>
                                            <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap italic">
                                                {substituteVariables(newCampaign.messages[lastActiveInput || 0] || 'Escribe un mensaje para ver la vista previa...', previewCandidate)}
                                            </p>
                                        </div>
                                    </div>
                                )}



                                {/* Schedule Controls */}
                                <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 space-y-4">
                                    <div className="flex items-center space-x-2">
                                        <Calendar className="w-5 h-5 text-gray-400" />
                                        <span className="font-bold text-gray-700 dark:text-gray-300">Programación del Envío</span>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <label className={`cursor-pointer p-3 rounded-lg border-2 flex items-center space-x-3 transition-all ${new Date(newCampaign.scheduledAt) <= new Date(Date.now() + 60000)
                                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                                            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                                            }`}>
                                            <input
                                                type="radio"
                                                name="scheduleType"
                                                className="hidden"
                                                checked={new Date(newCampaign.scheduledAt) <= new Date(Date.now() + 60000)}
                                                onChange={() => setNewCampaign({ ...newCampaign, scheduledAt: new Date().toISOString() })}
                                            />
                                            <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${new Date(newCampaign.scheduledAt) <= new Date(Date.now() + 60000) ? 'border-blue-500' : 'border-gray-400'
                                                }`}>
                                                {new Date(newCampaign.scheduledAt) <= new Date(Date.now() + 60000) && <div className="w-2 h-2 rounded-full bg-blue-500" />}
                                            </div>
                                            <span className="font-medium text-sm">Enviar Ahora Mismo</span>
                                        </label>

                                        <label className={`cursor-pointer p-3 rounded-lg border-2 flex flex-col space-y-2 transition-all ${new Date(newCampaign.scheduledAt) > new Date(Date.now() + 60000)
                                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                                            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                                            }`}>
                                            <div className="flex items-center space-x-3">
                                                <input
                                                    type="radio"
                                                    name="scheduleType"
                                                    className="hidden"
                                                    checked={new Date(newCampaign.scheduledAt) > new Date(Date.now() + 60000)}
                                                    onChange={() => {
                                                        const tomorrow = new Date();
                                                        tomorrow.setDate(tomorrow.getDate() + 1);
                                                        tomorrow.setHours(9, 0, 0, 0);
                                                        // Account for timezone offset for input
                                                        const z = tomorrow.getTimezoneOffset() * 60 * 1000;
                                                        const local = new Date(tomorrow - z);
                                                        setNewCampaign({ ...newCampaign, scheduledAt: local.toISOString().slice(0, 16) });
                                                    }}
                                                />
                                                <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${new Date(newCampaign.scheduledAt) > new Date(Date.now() + 60000) ? 'border-blue-500' : 'border-gray-400'
                                                    }`}>
                                                    {new Date(newCampaign.scheduledAt) > new Date(Date.now() + 60000) && <div className="w-2 h-2 rounded-full bg-blue-500" />}
                                                </div>
                                                <span className="font-medium text-sm">Programar Fecha/Hora</span>
                                            </div>

                                            {/* Show input only if selected */}
                                            {new Date(newCampaign.scheduledAt) > new Date(Date.now() + 60000) && (
                                                <input
                                                    type="datetime-local"
                                                    className="w-full px-2 py-1 text-sm border rounded bg-white dark:bg-gray-900"
                                                    value={newCampaign.scheduledAt}
                                                    onChange={e => setNewCampaign({ ...newCampaign, scheduledAt: e.target.value })}
                                                    onClick={(e) => e.stopPropagation()}
                                                />
                                            )}
                                        </label>
                                    </div>
                                </div>

                                <div className="flex justify-between pt-4">
                                    <Button variant="outline" onClick={() => setStep(2)}>Atrás</Button>
                                    <Button onClick={handleCreateCampaign} icon={Check} className="bg-green-600 hover:bg-green-700">Completar y Programar</Button>
                                </div>
                            </div>
                        )}
                    </div>
                </Card >
            </div >
        );
    }

    return (
        <div className="space-y-6">
            {/* Top Bar */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Campaña de Envíos Masivos</h2>
                    <p className="text-sm text-gray-500">Gestión inteligente de contactos a escala</p>
                </div>
                <div className="flex items-center space-x-2">
                    <Button onClick={loadCampaigns} icon={RefreshCw} variant="outline" size="sm" disabled={loading} />
                    <Button onClick={() => setView('create')} icon={Plus}>Crear Nueva Campaña</Button>
                </div>
            </div>

            {/* Stats Overview */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <StatCard label="Pendientes" value={stats.pending} color="bg-yellow-500" />
                <StatCard label="En Proceso" value={stats.sending} color="bg-blue-500" />
                <StatCard label="Completadas" value={stats.completed} color="bg-green-500" />
            </div>

            {/* Campaigns Table */}
            <Card title="Historial de Campañas">
                <div className="overflow-x-auto">
                    {loading ? (
                        <div className="p-12 text-center">
                            <Loader2 className="w-8 h-8 animate-spin mx-auto text-blue-600 mb-4" />
                            <p className="text-gray-500">Cargando historial...</p>
                        </div>
                    ) : campaigns.length === 0 ? (
                        <div className="p-12 text-center">
                            <Users className="w-12 h-12 mx-auto text-gray-300 mb-4" />
                            <p className="text-gray-500 font-medium">No has creado ninguna campaña aún</p>
                            <Button variant="outline" size="sm" className="mt-4" onClick={() => setView('create')}>Comienza Ahora</Button>
                        </div>
                    ) : (
                        <table className="w-full text-left">
                            <thead className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-700">
                                <tr>
                                    <th className="py-4 px-6 font-semibold text-gray-700 dark:text-gray-300">Campaña</th>
                                    <th className="py-4 px-6 font-semibold text-gray-700 dark:text-gray-300">Estado</th>
                                    <th className="py-4 px-6 font-semibold text-gray-700 dark:text-gray-300 text-center">Progreso</th>
                                    <th className="py-4 px-6 font-semibold text-gray-700 dark:text-gray-300">Programado</th>
                                    <th className="py-4 px-6 font-semibold text-gray-700 dark:text-gray-300 w-10"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
                                {campaigns.map(c => (
                                    <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-900 smooth-transition">
                                        <td className="py-4 px-6">
                                            <p className="font-bold text-gray-900 dark:text-white">{c.name}</p>
                                            <p className="text-xs text-gray-500 mt-0.5">{c.messages?.length || 0} variantes • {c.delaySeconds}s delay</p>
                                        </td>
                                        <td className="py-4 px-6">
                                            <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase ${c.status === 'completed' ? 'bg-green-100 text-green-700' :
                                                c.status === 'sending' ? 'bg-blue-100 text-blue-700' : 'bg-yellow-100 text-yellow-700'
                                                }`}>
                                                {c.status === 'completed' ? 'Completado' : c.status === 'sending' ? 'Enviando' : 'Pendiente'}
                                            </span>
                                        </td>
                                        <td className="py-4 px-6">
                                            <div className="flex items-center space-x-3">
                                                <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                                    <div
                                                        className={`h-full smooth-transition ${c.status === 'completed' ? 'bg-green-500' : 'bg-blue-500'}`}
                                                        style={{ width: `${(c.sentCount / (c.totalCount || 1)) * 100}%` }}
                                                    />
                                                </div>
                                                <span className="text-xs font-mono font-bold">{c.sentCount}/{c.totalCount}</span>
                                            </div>
                                        </td>
                                        <td className="py-4 px-6 text-sm text-gray-500 font-mono">
                                            {new Date(c.scheduledAt).toLocaleString()}
                                        </td>
                                        <td className="py-4 px-6">
                                            <div className="flex items-center space-x-2">
                                                <button
                                                    onClick={() => handleEditCampaign(c)}
                                                    className="p-2 text-gray-400 hover:text-blue-500 smooth-transition"
                                                    title="Editar"
                                                >
                                                    <Pencil className="w-4 h-4" />
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteCampaign(c.id)}
                                                    className="p-2 text-gray-400 hover:text-red-500 smooth-transition"
                                                    title="Eliminar"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </Card>
        </div>
    );
};

export default BulksSection;
