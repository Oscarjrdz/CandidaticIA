import React, { useState, useEffect } from 'react';
import { FolderPlus, Trash2, Plus, Pencil, Users, User, Search, X, Loader2, MessageCircle, Copy, ChevronRight } from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';
import { useConfirmModal } from './ui/ConfirmModal';
import { formatPhone, formatRelativeDate } from '../utils/formatters';
import ChatWindow from './ChatWindow';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

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
            {candidate.tags?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                    {candidate.tags.slice(0, 3).map((t, i) => (
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

    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

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
        const name = prompt('Nombre del nuevo paso:', 'Nuevo Paso');
        if (!name?.trim()) return;
        const newStep = { id: `step_${Date.now()}`, name: name.trim() };
        const steps = [...(activeProject.steps || []), newStep];
        await saveSteps(steps, 'Paso agregado');
    };

    const handleRenameStep = async (stepId) => {
        const step = activeProject.steps.find(s => s.id === stepId);
        if (!step) return;
        const newName = prompt('Nuevo nombre:', step.name);
        if (!newName?.trim() || newName === step.name) return;
        const steps = activeProject.steps.map(s => s.id === stepId ? { ...s, name: newName } : s);
        await saveSteps(steps, 'Paso renombrado');
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

    const handleDragEnd = async (event) => {
        const { active, over } = event;
        if (!over || !active.data.current?.candidate) return;
        const candidate = active.data.current.candidate;
        let targetStepId = null;
        if (over.id?.toString().startsWith('step_') || over.id === 'step_inicio') {
            targetStepId = over.id;
        } else if (over.data.current?.candidate) {
            targetStepId = over.data.current.candidate.crmMeta?.stepId;
        }
        if (!targetStepId || targetStepId === candidate.crmMeta?.stepId) return;
        setCandidates(prev => prev.map(c => c.id === candidate.id ? { ...c, crmMeta: { ...c.crmMeta, stepId: targetStepId } } : c));
        try {
            await fetch('/api/manual_projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'moveCandidate', projectId: activeProject.id, candidateId: candidate.id, stepId: targetStepId }) });
        } catch (e) { showToast('Error al mover', 'error'); }
    };

    const steps = activeProject?.steps || [];

    return (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
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
                                <div className="flex gap-2">
                                    <Button onClick={() => { setSearchOpen(true); setSearchQuery(''); setSearchResults([]); }}
                                        className="bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 rounded-xl text-xs font-bold px-3 py-2">
                                        <Plus className="w-3.5 h-3.5 mr-1" /> Agregar Candidatos
                                    </Button>
                                    <Button onClick={handleAddStep}
                                        className="bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 rounded-xl text-xs font-bold px-3 py-2">
                                        <Plus className="w-3.5 h-3.5 mr-1" /> Paso
                                    </Button>
                                </div>
                            </div>

                            {/* Kanban Columns */}
                            <div className="flex-1 overflow-x-auto overflow-y-hidden">
                                <div className="flex gap-4 h-full pb-4" style={{ minWidth: `${Math.max(steps.length * 280, 560)}px` }}>
                                    {steps.map(step => {
                                        const stepCands = candidates.filter(c => c.crmMeta?.stepId === step.id);
                                        return (
                                            <div key={step.id} className="w-72 shrink-0 flex flex-col bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-800 overflow-hidden">
                                                {/* Column Header */}
                                                <div className="px-4 py-3 flex items-center justify-between border-b border-slate-100 dark:border-slate-800">
                                                    <div className="flex items-center gap-2">
                                                        <h3 className="font-bold text-sm text-slate-700 dark:text-slate-200 truncate">{step.name}</h3>
                                                        <span className="text-[10px] bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-1.5 py-0.5 rounded-full font-bold">{stepCands.length}</span>
                                                    </div>
                                                    <div className="flex gap-0.5">
                                                        <button onClick={() => handleRenameStep(step.id)} className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400"><Pencil className="w-3 h-3" /></button>
                                                        {steps.length > 1 && (
                                                            <button onClick={() => handleDeleteStep(step.id)} className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-red-400"><Trash2 className="w-3 h-3" /></button>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Candidates */}
                                                <SortableContext items={stepCands.map(c => c.id)} strategy={verticalListSortingStrategy}>
                                                    <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar" data-step-id={step.id}
                                                        onDragOver={(e) => e.preventDefault()}>
                                                        {stepCands.length === 0 ? (
                                                            <div className="text-center py-8 text-slate-300 dark:text-slate-600 text-xs">
                                                                Arrastra candidatos aquí
                                                            </div>
                                                        ) : stepCands.map(c => (
                                                            <SortableCandCard key={c.id} candidate={c} onRemove={handleUnlink} onChat={setChatCandidate} />
                                                        ))}
                                                    </div>
                                                </SortableContext>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>

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

            {confirmModalJSX}
        </DndContext>
    );
};

export default CRMProjectsSection;
