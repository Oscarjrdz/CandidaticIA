import React, { useState, useEffect } from 'react';
import { FolderPlus, Trash2, Plus, Pencil, Users, User, Search, X, Loader2, MessageCircle, Copy, ChevronRight, GraduationCap, MapPin, Calendar, Palette } from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';
import { useConfirmModal } from './ui/ConfirmModal';
import { formatPhone, formatRelativeDate, calculateAge } from '../utils/formatters';
import ChatWindow from './ChatWindow';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragOverlay, useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// Droppable step container — accepts candidates dropped into it
const DroppableStepZone = ({ stepId, isOver, children }) => {
    const { setNodeRef, isOver: isDragOver } = useDroppable({ id: stepId, data: { type: 'step', stepId } });
    const highlight = isOver || isDragOver;
    return (
        <div ref={setNodeRef}
            className={`flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar transition-all duration-300 rounded-b-2xl ${
                highlight
                    ? 'bg-blue-50/80 dark:bg-blue-900/20 ring-2 ring-blue-400/40 ring-inset'
                    : ''
            }`}>
            {children}
        </div>
    );
};

const SortableCandCard = ({ candidate, onRemove, onChat }) => {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: candidate.id, data: { type: 'candidate', candidate }
    });
    const style = { transform: CSS.Translate.toString(transform), transition, opacity: isDragging ? 0.3 : 1 };
    return (
        <div ref={setNodeRef} style={style} {...attributes} {...listeners}
            className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-xl p-3 shadow-sm hover:shadow-md transition-all cursor-grab active:cursor-grabbing group">
            <div className="flex items-center gap-2">
                {candidate.profilePic ? (
                    <img src={candidate.profilePic} className="w-8 h-8 rounded-full object-cover" alt="" />
                ) : (
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white text-xs font-bold">
                        {(candidate.nombre || '?')[0]?.toUpperCase()}
                    </div>
                )}
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 truncate">{candidate.nombre || 'Sin nombre'}</p>
                    <p className="text-[10px] text-slate-400 truncate">{formatPhone(candidate.whatsapp)}</p>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={(e) => { e.stopPropagation(); onChat(candidate); }}
                        className="p-1 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30 text-blue-500"><MessageCircle className="w-3.5 h-3.5" /></button>
                    <button onClick={(e) => { e.stopPropagation(); onRemove(candidate.id); }}
                        className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/30 text-red-400"><X className="w-3.5 h-3.5" /></button>
                </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px] text-slate-500 font-medium mt-2">
                {candidate.municipio && (
                    <div className="flex items-center gap-0.5 whitespace-nowrap">
                        <MapPin className="w-2.5 h-2.5 text-blue-500" />
                        {candidate.municipio}
                    </div>
                )}
                {candidate.escolaridad && (
                    <div className="flex items-center gap-0.5 whitespace-nowrap">
                        <GraduationCap className="w-2.5 h-2.5 text-blue-500" />
                        {candidate.escolaridad}
                    </div>
                )}
                {(candidate.edad || candidate.fechaNacimiento) && (
                    <div className="flex items-center gap-0.5 whitespace-nowrap">
                        <Calendar className="w-2.5 h-2.5 text-blue-500" />
                        {calculateAge(candidate.fechaNacimiento, candidate.edad)}
                    </div>
                )}
                {candidate.genero && candidate.genero !== 'Desconocido' && (
                    <div className="flex items-center gap-0.5 whitespace-nowrap">
                        <User className="w-2.5 h-2.5 text-blue-500" />
                        {candidate.genero}
                    </div>
                )}
                {candidate.categoria && (
                    <div className="flex items-center gap-0.5 whitespace-nowrap px-1.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-800/50">
                        {candidate.categoria}
                    </div>
                )}
            </div>

            {candidate.tags?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                    {candidate.tags.map((t, i) => (
                        <span key={i} className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 font-medium">
                            {typeof t === 'string' ? t : t.name}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
};

const CRMProjectsSection = ({ showToast, user }) => {
    const { confirmModalJSX, showConfirm } = useConfirmModal();
    const [projects, setProjects] = useState([]);
    const [activeProject, setActiveProject] = useState(null);
    const [candidates, setCandidates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadingCands, setLoadingCands] = useState(false);
    const [showCreate, setShowCreate] = useState(false);
    const [projName, setProjName] = useState('');
    const [projDesc, setProjDesc] = useState('');
    const [editingProject, setEditingProject] = useState(null);
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [searching, setSearching] = useState(false);
    const [chatCandidate, setChatCandidate] = useState(null);

    // Step Edit Modal state
    const [editingStep, setEditingStep] = useState(null); // { id, name, color }
    const [stepEditName, setStepEditName] = useState('');
    const [stepEditColor, setStepEditColor] = useState('#3b82f6');

    const STEP_COLOR_PALETTE = [
        '#3b82f6', // blue
        '#8b5cf6', // violet
        '#ec4899', // pink
        '#ef4444', // red
        '#f97316', // orange
        '#eab308', // yellow
        '#22c55e', // green
        '#14b8a6', // teal
        '#06b6d4', // cyan
        '#6366f1', // indigo
        '#a855f7', // purple
        '#64748b', // slate
    ];

    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
    const [activeId, setActiveId] = useState(null);
    const [activeItem, setActiveItem] = useState(null);
    const [overStepId, setOverStepId] = useState(null);

    useEffect(() => { fetchProjects(); }, []);
    useEffect(() => { if (activeProject) fetchCandidates(activeProject.id); }, [activeProject?.id]);

    const fetchProjects = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/manual_projects');
            const data = await res.json();
            if (data.success) {
                setProjects(data.data);
                if (data.data.length > 0 && !activeProject) setActiveProject(data.data[0]);
            }
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    };

    const fetchCandidates = async (id) => {
        setLoadingCands(true);
        try {
            const res = await fetch(`/api/manual_projects?id=${id}&view=candidates`);
            const data = await res.json();
            if (data.success) setCandidates(data.candidates);
        } catch (e) { console.error(e); }
        finally { setLoadingCands(false); }
    };

    const handleCreate = async () => {
        if (!projName.trim()) return;
        try {
            const url = editingProject ? '/api/manual_projects' : '/api/manual_projects';
            const method = editingProject ? 'PUT' : 'POST';
            const body = editingProject
                ? { id: editingProject.id, name: projName, description: projDesc }
                : { name: projName, description: projDesc };
            const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            const data = await res.json();
            if (data.success) {
                if (editingProject) {
                    setProjects(prev => prev.map(p => p.id === data.data.id ? data.data : p));
                    if (activeProject?.id === data.data.id) setActiveProject(data.data);
                    showToast('Proyecto actualizado', 'success');
                } else {
                    setProjects(prev => [data.data, ...prev]);
                    setActiveProject(data.data);
                    showToast('Proyecto creado', 'success');
                }
                setShowCreate(false); setProjName(''); setProjDesc(''); setEditingProject(null);
            }
        } catch (e) { showToast('Error', 'error'); }
    };

    const handleDelete = async (id, e) => {
        e.stopPropagation();
        const ok = await showConfirm({ title: 'Eliminar proyecto', message: '¿Seguro? Se perderán todos los pasos y vínculos de candidatos.', confirmText: 'Eliminar', variant: 'danger' });
        if (!ok) return;
        try {
            await fetch(`/api/manual_projects?id=${id}`, { method: 'DELETE' });
            setProjects(prev => prev.filter(p => p.id !== id));
            if (activeProject?.id === id) { setActiveProject(null); setCandidates([]); }
            showToast('Proyecto eliminado', 'info');
        } catch (e) { showToast('Error', 'error'); }
    };

    const handleClone = async (id, e) => {
        e.stopPropagation();
        try {
            const res = await fetch('/api/manual_projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'clone', projectId: id }) });
            const data = await res.json();
            if (data.success) { setProjects(prev => [data.data, ...prev]); showToast('Proyecto clonado', 'success'); }
        } catch (e) { showToast('Error', 'error'); }
    };

    const handleAddStep = async () => {
        if (!activeProject) return;
        setEditingStep({ id: null, name: '', color: '#3b82f6' });
        setStepEditName('');
        setStepEditColor('#3b82f6');
    };

    const handleRenameStep = async (stepId) => {
        const step = activeProject.steps.find(s => s.id === stepId);
        if (!step) return;
        setEditingStep({ id: stepId, name: step.name, color: step.color || '#3b82f6' });
        setStepEditName(step.name);
        setStepEditColor(step.color || '#3b82f6');
    };

    const handleSaveStepEdit = async () => {
        if (!stepEditName.trim()) return;
        if (editingStep.id) {
            // Rename + color update
            const steps = activeProject.steps.map(s =>
                s.id === editingStep.id ? { ...s, name: stepEditName.trim(), color: stepEditColor } : s
            );
            await saveSteps(steps, 'Paso actualizado');
        } else {
            // New step
            const newStep = { id: `step_${Date.now()}`, name: stepEditName.trim(), color: stepEditColor };
            const steps = [...(activeProject.steps || []), newStep];
            await saveSteps(steps, 'Paso agregado');
        }
        setEditingStep(null);
    };

    const handleDeleteStep = async (stepId) => {
        const ok = await showConfirm({ title: 'Eliminar paso', message: '¿Seguro? Los candidatos en este paso se desvincularán.', confirmText: 'Eliminar', variant: 'danger' });
        if (!ok) return;
        const steps = activeProject.steps.filter(s => s.id !== stepId);
        await saveSteps(steps, 'Paso eliminado');
    };

    const saveSteps = async (steps, msg) => {
        const updated = { ...activeProject, steps };
        setActiveProject(updated);
        setProjects(prev => prev.map(p => p.id === activeProject.id ? updated : p));
        try {
            await fetch('/api/manual_projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'updateSteps', projectId: activeProject.id, steps }) });
            showToast(msg, 'success');
        } catch (e) { showToast('Error', 'error'); }
    };

    const handleSearch = async () => {
        if (!searchQuery.trim()) return;
        setSearching(true);
        try {
            const res = await fetch('/api/candidates');
            const data = await res.json();
            if (data.success) {
                const q = searchQuery.toLowerCase();
                const linked = new Set(candidates.map(c => c.id));
                const filtered = data.candidates.filter(c =>
                    !linked.has(c.id) && ((c.nombre || '').toLowerCase().includes(q) || (c.whatsapp || '').includes(q))
                ).slice(0, 20);
                setSearchResults(filtered);
            }
        } catch (e) { console.error(e); }
        finally { setSearching(false); }
    };

    const handleLinkCandidate = async (candidateId) => {
        if (!activeProject) return;
        const stepId = activeProject.steps?.[0]?.id || 'step_inicio';
        try {
            await fetch('/api/manual_projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'linkCandidate', projectId: activeProject.id, candidateId, stepId }) });
            setSearchResults(prev => prev.filter(c => c.id !== candidateId));
            fetchCandidates(activeProject.id);
            showToast('Candidato vinculado', 'success');
        } catch (e) { showToast('Error', 'error'); }
    };

    const handleUnlink = async (candidateId) => {
        if (!activeProject) return;
        try {
            await fetch('/api/manual_projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'unlinkCandidate', projectId: activeProject.id, candidateId }) });
            setCandidates(prev => prev.filter(c => c.id !== candidateId));
            showToast('Candidato removido', 'info');
        } catch (e) { showToast('Error', 'error'); }
    };

    const handleDragStart = (event) => {
        const { active } = event;
        setActiveId(active.id);
        setActiveItem(active.data.current);
    };

    const handleDragOver = (event) => {
        const { over } = event;
        if (!over) { setOverStepId(null); return; }
        // Determine which step we're hovering over
        if (over.data.current?.type === 'step') {
            setOverStepId(over.id);
        } else if (over.data.current?.candidate) {
            setOverStepId(over.data.current.candidate.crmMeta?.stepId || null);
        } else {
            setOverStepId(null);
        }
    };

    const handleDragEnd = async (event) => {
        const { active, over } = event;
        setActiveId(null);
        setActiveItem(null);
        setOverStepId(null);

        if (!over || !active.data.current?.candidate) return;
        const candidate = active.data.current.candidate;
        const currentStepId = candidate.crmMeta?.stepId;

        // Determine target step
        let targetStepId = null;
        if (over.data.current?.type === 'step') {
            targetStepId = over.data.current.stepId;
        } else if (over.data.current?.candidate) {
            targetStepId = over.data.current.candidate.crmMeta?.stepId;
        }

        if (!targetStepId) return;

        // CASE 1: Reorder within the SAME step
        if (currentStepId === targetStepId && over.data.current?.candidate) {
            const stepCands = candidates.filter(c => c.crmMeta?.stepId === currentStepId);
            const oldIndex = stepCands.findIndex(c => c.id === active.id);
            const newIndex = stepCands.findIndex(c => c.id === over.id);
            if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
                const reordered = arrayMove(stepCands, oldIndex, newIndex);
                // Rebuild full candidates list: replace the step's candidates in order
                const otherCands = candidates.filter(c => c.crmMeta?.stepId !== currentStepId);
                setCandidates([...otherCands, ...reordered]);
                // Persist order
                try {
                    await fetch('/api/manual_projects', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            action: 'reorderCandidates',
                            projectId: activeProject.id,
                            stepId: currentStepId,
                            candidateIds: reordered.map(c => c.id)
                        })
                    });
                } catch (e) { console.error('Reorder error:', e); }
            }
            return;
        }

        // CASE 2: Move to a DIFFERENT step
        if (currentStepId !== targetStepId) {
            setCandidates(prev => prev.map(c =>
                c.id === candidate.id ? { ...c, crmMeta: { ...c.crmMeta, stepId: targetStepId } } : c
            ));
            try {
                await fetch('/api/manual_projects', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'moveCandidate', projectId: activeProject.id, candidateId: candidate.id, stepId: targetStepId })
                });
            } catch (e) { showToast('Error al mover', 'error'); }
        }
    };

    const handleDragCancel = () => {
        setActiveId(null);
        setActiveItem(null);
        setOverStepId(null);
    };

    const steps = activeProject?.steps || [];

    return (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd} onDragCancel={handleDragCancel}>
            <div className="flex gap-6 h-full min-h-0">
                {/* LEFT SIDEBAR — Project List */}
                <div className="w-72 shrink-0 flex flex-col gap-3">
                    <Button onClick={() => { setEditingProject(null); setProjName(''); setProjDesc(''); setShowCreate(true); }}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-xl py-3 font-bold shadow-lg shadow-blue-500/20">
                        <FolderPlus className="w-4 h-4 mr-2" /> Nuevo Proyecto
                    </Button>

                    <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                        {loading ? (
                            <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>
                        ) : projects.length === 0 ? (
                            <div className="text-center py-12 text-slate-400 text-sm">No hay proyectos aún</div>
                        ) : projects.map(p => (
                            <div key={p.id} onClick={() => setActiveProject(p)}
                                className={`group p-4 rounded-2xl cursor-pointer border transition-all duration-300 ${activeProject?.id === p.id
                                    ? 'bg-blue-600 border-blue-500 text-white shadow-xl shadow-blue-500/20 scale-[1.02]'
                                    : 'bg-white border-slate-100 dark:bg-slate-800 dark:border-slate-700 hover:border-blue-300 hover:shadow-lg'}`}>
                                <div className="flex items-center justify-between">
                                    <div className="min-w-0 flex-1">
                                        <h3 className={`font-bold truncate ${activeProject?.id === p.id ? 'text-white' : 'text-slate-700 dark:text-slate-200'}`}>{p.name}</h3>
                                        <p className={`text-xs mt-1 truncate ${activeProject?.id === p.id ? 'text-blue-100' : 'text-slate-400'}`}>{p.description || 'Sin descripción'}</p>
                                    </div>
                                    <div className="flex gap-1 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button onClick={(e) => { e.stopPropagation(); setEditingProject(p); setProjName(p.name); setProjDesc(p.description || ''); setShowCreate(true); }}
                                            className="p-1 rounded hover:bg-white/20"><Pencil className="w-3.5 h-3.5" /></button>
                                        <button onClick={(e) => handleClone(p.id, e)} className="p-1 rounded hover:bg-white/20"><Copy className="w-3.5 h-3.5" /></button>
                                        <button onClick={(e) => handleDelete(p.id, e)} className="p-1 rounded hover:bg-red-500/20 text-red-300"><Trash2 className="w-3.5 h-3.5" /></button>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 mt-2">
                                    <span className={`text-[10px] font-medium ${activeProject?.id === p.id ? 'text-blue-200' : 'text-slate-400'}`}>
                                        {p.steps?.length || 0} pasos
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* RIGHT — Kanban Board */}
                <div className="flex-1 min-w-0 flex flex-col gap-4">
                    {!activeProject ? (
                        <div className="flex-1 flex items-center justify-center">
                            <div className="text-center text-slate-400">
                                <Users className="w-16 h-16 mx-auto mb-4 opacity-30" />
                                <p className="text-lg font-medium">Selecciona o crea un proyecto</p>
                            </div>
                        </div>
                    ) : (
                        <>
                            {/* Toolbar */}
                            <div className="flex items-center justify-between">
                                <h2 className="text-xl font-black text-slate-800 dark:text-white truncate">{activeProject.name}</h2>
                                <Button onClick={handleAddStep}
                                    className="bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 rounded-xl text-xs font-bold px-3 py-2">
                                    <Plus className="w-3.5 h-3.5 mr-1" /> Paso
                                </Button>
                            </div>

                            {/* Kanban Columns */}
                            <div className="flex-1 overflow-x-auto overflow-y-hidden">
                                <div className="flex gap-4 h-full pb-4" style={{ minWidth: `${Math.max(steps.length * 280, 560)}px` }}>
                                    {steps.map(step => {
                                        const stepCands = candidates.filter(c => c.crmMeta?.stepId === step.id);
                                        const stepColor = step.color || '#64748b';

                                        return (
                                            <div key={step.id}
                                                className="w-72 shrink-0 flex flex-col rounded-2xl border overflow-hidden"
                                                style={{
                                                    backgroundColor: `${stepColor}08`,
                                                    borderColor: `${stepColor}25`
                                                }}>
                                                {/* Column Header */}
                                                <div className="px-4 py-3 flex items-center justify-between"
                                                    style={{
                                                        backgroundColor: stepColor,
                                                        borderBottom: `1px solid ${stepColor}40`
                                                    }}>
                                                    <div className="flex items-center gap-2">
                                                        <h3 className="font-bold text-sm text-white truncate">{step.name}</h3>
                                                        <span className="text-[10px] bg-white/25 text-white px-1.5 py-0.5 rounded-full font-bold">{stepCands.length}</span>
                                                    </div>
                                                    <div className="flex gap-0.5">
                                                        <button onClick={() => handleRenameStep(step.id)} className="p-1 rounded hover:bg-white/20 text-white/70 hover:text-white transition-colors"><Pencil className="w-3 h-3" /></button>
                                                        {steps.length > 1 && (
                                                            <button onClick={() => handleDeleteStep(step.id)} className="p-1 rounded hover:bg-white/20 text-white/70 hover:text-white transition-colors"><Trash2 className="w-3 h-3" /></button>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Candidates */}
                                                <SortableContext items={stepCands.map(c => c.id)} strategy={verticalListSortingStrategy}>
                                                    <DroppableStepZone stepId={step.id} isOver={overStepId === step.id}>
                                                        {stepCands.length === 0 ? (
                                                            <div className={`text-center py-8 text-xs rounded-xl border-2 border-dashed transition-all duration-300 ${
                                                                overStepId === step.id
                                                                    ? 'border-blue-400 text-blue-400 bg-blue-50/50 dark:bg-blue-900/10'
                                                                    : 'border-transparent text-slate-300 dark:text-slate-600'
                                                            }`}>
                                                                Arrastra candidatos aquí
                                                            </div>
                                                        ) : stepCands.map(c => (
                                                            <SortableCandCard key={c.id} candidate={c} onRemove={handleUnlink} onChat={setChatCandidate} />
                                                        ))}
                                                    </DroppableStepZone>
                                                </SortableContext>
                                            </div>
                                        );
                                    })}

                                    {/* Add Step Column */}
                                    <div onClick={handleAddStep}
                                        className="w-72 shrink-0 flex flex-col items-center justify-center bg-slate-50/50 dark:bg-slate-900/30 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-blue-900/10 cursor-pointer transition-all duration-300 group min-h-[200px]">
                                        <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 group-hover:bg-blue-100 dark:group-hover:bg-blue-900/40 flex items-center justify-center transition-colors mb-3">
                                            <Plus className="w-6 h-6 text-slate-300 dark:text-slate-600 group-hover:text-blue-500 transition-colors" />
                                        </div>
                                        <p className="text-sm font-bold text-slate-300 dark:text-slate-600 group-hover:text-blue-500 transition-colors">Nuevo Paso</p>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Drag Overlay — floating preview of dragged card */}
            <DragOverlay dropAnimation={{
                duration: 250,
                easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)'
            }}>
                {activeId && activeItem?.candidate ? (
                    <div className="p-3 rounded-xl bg-white dark:bg-slate-800 border-2 border-blue-400 shadow-2xl shadow-blue-500/30 min-w-[220px] max-w-[280px] scale-105 rotate-[1deg] opacity-95">
                        <div className="flex items-center gap-2">
                            {activeItem.candidate.profilePic ? (
                                <img src={activeItem.candidate.profilePic} className="w-8 h-8 rounded-full object-cover" alt="" />
                            ) : (
                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white text-xs font-bold">
                                    {(activeItem.candidate.nombre || '?')[0]?.toUpperCase()}
                                </div>
                            )}
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-bold text-slate-700 dark:text-slate-200 truncate">{activeItem.candidate.nombre || 'Sin nombre'}</p>
                                <p className="text-[10px] text-slate-400 truncate">{formatPhone(activeItem.candidate.whatsapp)}</p>
                            </div>
                        </div>
                    </div>
                ) : null}
            </DragOverlay>

            {/* Create/Edit Modal */}
            {showCreate && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowCreate(false)}>
                    <div onClick={e => e.stopPropagation()} className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4 animate-in zoom-in-95 duration-200">
                        <h3 className="text-lg font-black text-slate-800 dark:text-white">{editingProject ? 'Editar Proyecto' : 'Nuevo Proyecto'}</h3>
                        <input value={projName} onChange={e => setProjName(e.target.value)} placeholder="Nombre del proyecto"
                            className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm outline-none focus:border-blue-500 dark:text-white" autoFocus />
                        <textarea value={projDesc} onChange={e => setProjDesc(e.target.value)} placeholder="Descripción (opcional)" rows={2}
                            className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm outline-none focus:border-blue-500 dark:text-white resize-none" />
                        <p className="text-xs text-slate-400">Se creará con un paso inicial "Inicio" que puedes renombrar.</p>
                        <div className="flex gap-3">
                            <Button onClick={() => setShowCreate(false)} className="flex-1 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl py-3 font-bold">Cancelar</Button>
                            <Button onClick={handleCreate} disabled={!projName.trim()} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl py-3 font-bold">{editingProject ? 'Guardar' : 'Crear'}</Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Search/Add Candidates Modal */}
            {searchOpen && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setSearchOpen(false)}>
                    <div onClick={e => e.stopPropagation()} className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4 animate-in zoom-in-95 duration-200 max-h-[80vh] flex flex-col">
                        <div className="flex items-center justify-between">
                            <h3 className="text-lg font-black text-slate-800 dark:text-white">Agregar Candidatos</h3>
                            <button onClick={() => setSearchOpen(false)} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"><X className="w-5 h-5 text-slate-400" /></button>
                        </div>
                        <div className="flex gap-2">
                            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearch()}
                                placeholder="Buscar por nombre o teléfono..."
                                className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm outline-none focus:border-blue-500 dark:text-white" autoFocus />
                            <Button onClick={handleSearch} disabled={searching} className="bg-blue-600 text-white rounded-xl px-4 font-bold">
                                {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                            </Button>
                        </div>
                        <div className="flex-1 overflow-y-auto space-y-2">
                            {searchResults.length === 0 ? (
                                <p className="text-center text-slate-400 text-sm py-8">{searching ? 'Buscando...' : 'Busca candidatos para agregar al proyecto'}</p>
                            ) : searchResults.map(c => (
                                <div key={c.id} className="flex items-center gap-3 p-3 rounded-xl border border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                                    {c.profilePic ? (
                                        <img src={c.profilePic} className="w-9 h-9 rounded-full object-cover" alt="" />
                                    ) : (
                                        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white text-xs font-bold">{(c.nombre||'?')[0]?.toUpperCase()}</div>
                                    )}
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 truncate">{c.nombre}</p>
                                        <p className="text-[10px] text-slate-400">{formatPhone(c.whatsapp)}</p>
                                    </div>
                                    <Button onClick={() => handleLinkCandidate(c.id)} className="bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-lg px-3 py-1.5 font-bold">
                                        <Plus className="w-3 h-3 mr-1" /> Agregar
                                    </Button>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Chat Window */}
            {chatCandidate && (
                <ChatWindow isOpen={!!chatCandidate} onClose={() => setChatCandidate(null)} candidate={chatCandidate} />
            )}

            {/* Step Edit Modal */}
            {editingStep && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setEditingStep(null)}>
                    <div onClick={e => e.stopPropagation()} className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4 animate-in zoom-in-95 duration-200">
                        <h3 className="text-lg font-black text-slate-800 dark:text-white">
                            {editingStep.id ? 'Editar Paso' : 'Nuevo Paso'}
                        </h3>
                        <input
                            value={stepEditName}
                            onChange={e => setStepEditName(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleSaveStepEdit()}
                            placeholder="Nombre del paso"
                            className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm outline-none focus:border-blue-500 dark:text-white"
                            autoFocus
                        />

                        {/* Color Picker */}
                        <div>
                            <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5 mb-2">
                                <Palette className="w-3.5 h-3.5" />
                                Color de encabezado
                            </label>
                            <div className="flex flex-wrap gap-2">
                                {STEP_COLOR_PALETTE.map(color => (
                                    <button
                                        key={color}
                                        onClick={() => setStepEditColor(color)}
                                        className={`w-8 h-8 rounded-xl transition-all duration-200 border-2 hover:scale-110 ${
                                            stepEditColor === color
                                                ? 'border-slate-800 dark:border-white scale-110 shadow-lg'
                                                : 'border-transparent hover:border-slate-300'
                                        }`}
                                        style={{ backgroundColor: color }}
                                        title={color}
                                    />
                                ))}
                            </div>
                            {/* Preview */}
                            <div className="mt-3 rounded-xl overflow-hidden border" style={{ borderColor: `${stepEditColor}30` }}>
                                <div className="px-3 py-2 flex items-center gap-2" style={{ backgroundColor: stepEditColor }}>
                                    <span className="text-white text-xs font-bold truncate">{stepEditName || 'Vista previa'}</span>
                                    <span className="text-[9px] bg-white/25 text-white px-1.5 py-0.5 rounded-full font-bold">3</span>
                                </div>
                                <div className="px-3 py-3 text-[10px] text-slate-400" style={{ backgroundColor: `${stepEditColor}08` }}>
                                    Candidatos irán aquí...
                                </div>
                            </div>
                        </div>

                        <div className="flex gap-3">
                            <Button onClick={() => setEditingStep(null)} className="flex-1 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl py-3 font-bold">Cancelar</Button>
                            <Button onClick={handleSaveStepEdit} disabled={!stepEditName.trim()} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl py-3 font-bold">
                                {editingStep.id ? 'Guardar' : 'Crear'}
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {confirmModalJSX}
        </DndContext>
    );
};

export default CRMProjectsSection;
