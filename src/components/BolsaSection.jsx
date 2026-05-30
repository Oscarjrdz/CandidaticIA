import React, { useState, useEffect, useRef } from 'react';
import { Briefcase, Plus, Building2, Tag, Loader2, Trash2, Pencil, Power, Smartphone, Image as ImageIcon, MessageSquare, Heart, Users, Clock, Phone, X, Eye } from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';
import Input from './ui/Input';
import Modal from './ui/Modal';
import { useConfirmModal } from './ui/ConfirmModal';
import { useToastContext } from '../contexts/ToastContext';

const PAGE_SIZE = 12;

const BolsaSection = () => {
    const [jobs, setJobs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [editingJob, setEditingJob] = useState(null);
    const [detailJob, setDetailJob] = useState(null);
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
    const sentinelRef = useRef(null);
    const { confirmModalJSX, showConfirm } = useConfirmModal();
    const { showToast } = useToastContext();

    const defaultForm = {
        title: '', company: '', location: '', salary: '',
        type: 'Tiempo Completo', recruiterPhone: '', description: '',
        mediaUrl: '', companyLogo: ''
    };
    const [formData, setFormData] = useState(defaultForm);

    useEffect(() => { loadJobs(); }, []);

    // Infinite scroll — carga más tarjetas al llegar al centinela
    useEffect(() => {
        const el = sentinelRef.current;
        if (!el) return;
        const observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) {
                setVisibleCount(prev => Math.min(prev + PAGE_SIZE, jobs.length));
            }
        }, { threshold: 0.1 });
        observer.observe(el);
        return () => observer.disconnect();
    }, [jobs.length]);

    const loadJobs = async () => {
        try {
            const res = await fetch('/api/bolsa');
            const data = await res.json();
            if (data.success) {
                setJobs(data.data || []);
                setVisibleCount(PAGE_SIZE);
            }
        } catch (error) {
            console.error('Error loading bolsa jobs:', error);
            showToast('Error al cargar la bolsa de empleo', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleOpenCreate = () => {
        setEditingJob(null);
        setFormData(defaultForm);
        setIsModalOpen(true);
    };

    const handleEdit = (job) => {
        setEditingJob(job);
        setFormData({
            title: job.title || '', company: job.company || '',
            location: job.location || '', salary: job.salary || '',
            type: job.type || 'Tiempo Completo', recruiterPhone: job.recruiterPhone || '',
            description: job.description || '', mediaUrl: job.mediaUrl || '',
            companyLogo: job.companyLogo || ''
        });
        setIsModalOpen(true);
    };

    const handleSave = async () => {
        if (!formData.title || !formData.company || !formData.recruiterPhone) {
            showToast('El título, compañía y teléfono son obligatorios', 'error');
            return;
        }
        setSaving(true);
        try {
            const isEditing = !!editingJob;
            const method = isEditing ? 'PUT' : 'POST';
            const body = isEditing ? { ...formData, id: editingJob.id } : formData;
            const res = await fetch('/api/bolsa', {
                method, headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await res.json();
            if (data.success) {
                showToast(isEditing ? 'Vacante actualizada' : 'Vacante creada', 'success');
                setIsModalOpen(false);
                loadJobs();
            } else {
                showToast(data.error || 'Error al guardar', 'error');
            }
        } catch (error) {
            showToast('Error de conexión', 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleToggleActive = async (job) => {
        try {
            const res = await fetch('/api/bolsa', {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: job.id, active: !job.active })
            });
            if (res.ok) {
                showToast(job.active !== false ? 'Vacante pausada' : 'Vacante activada', 'success');
                loadJobs();
            }
        } catch (error) {
            showToast('Error al actualizar', 'error');
        }
    };

    const handleDelete = async (id) => {
        const confirmed = await showConfirm({
            title: 'Eliminar Vacante', message: '¿Seguro que deseas eliminar esta vacante de la app móvil?',
            confirmText: 'Eliminar', cancelText: 'Cancelar', variant: 'danger'
        });
        if (!confirmed) return;
        try {
            const res = await fetch(`/api/bolsa?id=${id}`, { method: 'DELETE' });
            if (res.ok) { showToast('Vacante eliminada', 'success'); loadJobs(); }
        } catch (error) {
            showToast('Error al eliminar', 'error');
        }
    };

    const handleDeleteComment = async (jobId, commentId) => {
        const confirmed = await showConfirm({
            title: 'Eliminar Comentario', message: '¿Seguro?',
            confirmText: 'Eliminar', cancelText: 'Cancelar', variant: 'danger'
        });
        if (!confirmed) return;
        try {
            await fetch('/api/bolsa?action=deleteComment', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jobId, commentId })
            });
            showToast('Comentario eliminado', 'success');
            loadJobs();
        } catch (error) {
            showToast('Error al eliminar comentario', 'error');
        }
    };

    const fmtDate = (d) => {
        if (!d) return '-';
        return new Date(d).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    const visibleJobs = jobs.slice(0, visibleCount);

    return (
        <div className="space-y-4 w-full pb-8">
            {/* Header Banner */}
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-3xl shadow-lg p-6 flex flex-col md:flex-row items-center justify-between gap-4 text-white">
                <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
                        <Smartphone className="w-6 h-6 text-white" />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold uppercase tracking-tight">Bolsa de Empleo (APP)</h2>
                        <p className="text-blue-100 text-sm mt-1">
                            {jobs.length > 0 ? `${jobs.length} vacantes · mostrando ${visibleJobs.length}` : 'Administra vacantes, comentarios, postulaciones y solicitudes.'}
                        </p>
                    </div>
                </div>
                <button onClick={handleOpenCreate} className="flex items-center gap-2 px-4 py-2 bg-white text-blue-600 rounded-xl font-bold shadow-sm hover:scale-105 transition-all">
                    <Plus className="w-5 h-5" /> Crear Vacante
                </button>
            </div>

            {/* Grid de vacantes */}
            {loading ? (
                <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>
            ) : jobs.length === 0 ? (
                <Card>
                    <div className="text-center py-12">
                        <div className="mx-auto w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mb-4">
                            <Smartphone className="w-8 h-8 text-blue-600 dark:text-blue-400" />
                        </div>
                        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">Bolsa de Empleo Vacía</h3>
                        <p className="text-gray-500 dark:text-gray-400 max-w-md mx-auto mb-6">Publica tu primer trabajo para que los candidatos lo vean en su celular.</p>
                        <Button onClick={handleOpenCreate} variant="outline">Crear Vacante</Button>
                    </div>
                </Card>
            ) : (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        {visibleJobs.map((job) => {
                            const appCount = (job.applications || []).length;
                            const commCount = (job.comments || []).length;
                            const reqCount = (job.requests || []).length;
                            const isActive = job.active !== false;

                            return (
                                <div key={job.id} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 flex flex-col overflow-hidden hover:shadow-lg transition-all group">
                                    {/* Imagen de vacante */}
                                    {job.mediaUrl ? (
                                        <div className="relative h-32 flex-shrink-0">
                                            <img src={job.mediaUrl} alt="" className="w-full h-full object-cover" />
                                            <span className={`absolute top-2 right-2 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest ${isActive ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}`}>
                                                {isActive ? 'Pública' : 'Oculta'}
                                            </span>
                                        </div>
                                    ) : (
                                        <div className="h-20 bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-blue-900/20 dark:to-indigo-900/20 flex items-center justify-center flex-shrink-0 relative">
                                            <Briefcase className="w-8 h-8 text-blue-300" />
                                            <span className={`absolute top-2 right-2 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest ${isActive ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}`}>
                                                {isActive ? 'Pública' : 'Oculta'}
                                            </span>
                                        </div>
                                    )}

                                    <div className="p-3 flex flex-col flex-1 gap-2">
                                        {/* Logo + título */}
                                        <div className="flex items-start gap-2">
                                            {job.companyLogo ? (
                                                <img src={job.companyLogo} alt="" className="w-8 h-8 rounded-lg object-cover border border-gray-200 dark:border-gray-600 flex-shrink-0" />
                                            ) : (
                                                <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                                                    <Building2 className="w-4 h-4 text-blue-500" />
                                                </div>
                                            )}
                                            <div className="min-w-0">
                                                <h3 className="text-sm font-bold text-gray-900 dark:text-white leading-tight line-clamp-1">{job.title}</h3>
                                                <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{job.company}</p>
                                            </div>
                                        </div>

                                        {/* Tags */}
                                        <div className="flex flex-wrap gap-1">
                                            {job.location && (
                                                <span className="text-[10px] bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded-md truncate max-w-full">
                                                    📍 {job.location}
                                                </span>
                                            )}
                                            {job.salary && (
                                                <span className="text-[10px] bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded-md">
                                                    💰 {job.salary}
                                                </span>
                                            )}
                                            <span className="text-[10px] bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded-md">
                                                {job.type}
                                            </span>
                                        </div>

                                        {/* Stats */}
                                        <div className="flex items-center justify-between text-[10px] text-gray-400 dark:text-gray-500 mt-auto pt-1">
                                            <span className="flex items-center gap-0.5"><Heart className="w-3 h-3 text-red-400" />{job.likes || 0}</span>
                                            <span className="flex items-center gap-0.5"><MessageSquare className="w-3 h-3 text-blue-400" />{commCount}</span>
                                            <span className="flex items-center gap-0.5"><Users className="w-3 h-3 text-green-500" />{appCount}</span>
                                            <span className="flex items-center gap-0.5"><Phone className="w-3 h-3 text-purple-400" />{reqCount}</span>
                                        </div>

                                        {/* Acciones */}
                                        <div className="flex items-center gap-1 pt-2 border-t border-gray-100 dark:border-gray-700">
                                            <button
                                                onClick={() => setDetailJob(job)}
                                                className="flex-1 py-1.5 rounded-lg text-[11px] font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50 transition-all flex items-center justify-center gap-1"
                                            >
                                                <Eye className="w-3 h-3" /> Ver
                                            </button>
                                            <button
                                                onClick={() => handleToggleActive(job)}
                                                className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold transition-all ${isActive ? 'text-gray-600 bg-gray-100 hover:bg-red-50 hover:text-red-600 dark:bg-gray-700 dark:text-gray-300' : 'text-green-600 bg-green-50 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400'}`}
                                            >
                                                {isActive ? 'Pausar' : 'Activar'}
                                            </button>
                                            <button
                                                onClick={() => handleEdit(job)}
                                                className="p-1.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-blue-50 hover:text-blue-600 rounded-lg transition-all"
                                            >
                                                <Pencil className="w-3.5 h-3.5" />
                                            </button>
                                            <button
                                                onClick={() => handleDelete(job.id)}
                                                className="p-1.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-red-50 hover:text-red-600 rounded-lg transition-all"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Centinela de infinite scroll */}
                    {visibleCount < jobs.length && (
                        <div ref={sentinelRef} className="flex justify-center py-6">
                            <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
                        </div>
                    )}
                </>
            )}

            {/* Modal Detalle de Vacante */}
            <Modal isOpen={!!detailJob} onClose={() => setDetailJob(null)} title={detailJob?.title || 'Detalle'}>
                {detailJob && (() => {
                    const appCount = (detailJob.applications || []).length;
                    const commCount = (detailJob.comments || []).length;
                    const reqCount = (detailJob.requests || []).length;
                    return (
                        <div className="space-y-6">
                            {/* Info básica */}
                            <div className="flex items-start gap-4">
                                {detailJob.companyLogo ? (
                                    <img src={detailJob.companyLogo} alt="" className="w-14 h-14 rounded-xl object-cover border border-gray-200 dark:border-gray-700 flex-shrink-0" />
                                ) : (
                                    <div className="w-14 h-14 rounded-xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                                        <Building2 className="w-7 h-7 text-blue-500" />
                                    </div>
                                )}
                                <div className="flex-1 min-w-0">
                                    <p className="text-gray-500 dark:text-gray-400 text-sm">{detailJob.company}</p>
                                    <div className="flex flex-wrap gap-1.5 mt-2">
                                        {detailJob.location && <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-1 rounded-lg">📍 {detailJob.location}</span>}
                                        {detailJob.salary && <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-1 rounded-lg">💰 {detailJob.salary}</span>}
                                        <span className="text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-2 py-1 rounded-lg">{detailJob.type}</span>
                                    </div>
                                </div>
                                <span className={`px-2 py-1 rounded-md text-[10px] font-black uppercase flex-shrink-0 ${detailJob.active !== false ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400'}`}>
                                    {detailJob.active !== false ? 'Pública' : 'Oculta'}
                                </span>
                            </div>

                            {detailJob.mediaUrl && (
                                <img src={detailJob.mediaUrl} alt="" className="w-full max-h-48 object-cover rounded-xl border border-gray-200 dark:border-gray-700" />
                            )}

                            {/* Descripción */}
                            {detailJob.description && (
                                <div>
                                    <h4 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">📝 Descripción</h4>
                                    <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap leading-relaxed">{detailJob.description}</p>
                                </div>
                            )}

                            {/* Postulaciones */}
                            <div>
                                <h4 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2">
                                    <Users className="w-4 h-4 text-green-500" /> Postulaciones ({appCount})
                                </h4>
                                {appCount === 0 ? (
                                    <p className="text-xs text-gray-400 italic">Sin postulaciones aún</p>
                                ) : (
                                    <div className="space-y-2 max-h-48 overflow-y-auto">
                                        {(detailJob.applications || []).map(app => (
                                            <div key={app.id} className="flex items-center justify-between bg-green-50 dark:bg-green-900/20 rounded-lg px-3 py-2 text-sm">
                                                <div>
                                                    <span className="font-bold text-gray-900 dark:text-white">{app.candidateName}</span>
                                                    <span className="text-gray-500 ml-2">{app.candidatePhone}</span>
                                                </div>
                                                <span className="text-xs text-gray-400">{fmtDate(app.createdAt)}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Solicitudes de Contacto */}
                            <div>
                                <h4 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2">
                                    <Phone className="w-4 h-4 text-purple-500" /> Solicitudes de Contacto ({reqCount})
                                </h4>
                                {reqCount === 0 ? (
                                    <p className="text-xs text-gray-400 italic">Sin solicitudes aún</p>
                                ) : (
                                    <div className="space-y-2 max-h-48 overflow-y-auto">
                                        {(detailJob.requests || []).map(r => (
                                            <div key={r.id} className="flex items-center justify-between bg-purple-50 dark:bg-purple-900/20 rounded-lg px-3 py-2 text-sm">
                                                <div className="flex items-center gap-2">
                                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${r.requestType === 'call' ? 'bg-purple-200 text-purple-700' : 'bg-cyan-200 text-cyan-700'}`}>
                                                        {r.requestType === 'call' ? '📞 Llamar' : '💬 WhatsApp'}
                                                    </span>
                                                    <span className="font-bold text-gray-900 dark:text-white">{r.candidateName}</span>
                                                    <span className="text-gray-500">{r.candidatePhone}</span>
                                                </div>
                                                <div className="text-right">
                                                    <span className="text-xs text-orange-600 font-medium">⏰ {r.timePreference}</span>
                                                    <span className="text-xs text-gray-400 ml-2">{fmtDate(r.createdAt)}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Comentarios */}
                            <div>
                                <h4 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2">
                                    <MessageSquare className="w-4 h-4 text-blue-500" /> Comentarios ({commCount})
                                </h4>
                                {commCount === 0 ? (
                                    <p className="text-xs text-gray-400 italic">Sin comentarios aún</p>
                                ) : (
                                    <div className="space-y-2 max-h-60 overflow-y-auto">
                                        {(detailJob.comments || []).map(c => (
                                            <div key={c.id} className="bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2 text-sm group/comment">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-bold text-gray-900 dark:text-white">{c.user}</span>
                                                        <span className="text-xs text-gray-400">{fmtDate(c.createdAt)}</span>
                                                    </div>
                                                    <button onClick={() => handleDeleteComment(detailJob.id, c.id)} className="opacity-0 group-hover/comment:opacity-100 p-1 hover:bg-red-50 rounded transition-all">
                                                        <X className="w-3.5 h-3.5 text-red-500" />
                                                    </button>
                                                </div>
                                                <p className="text-gray-600 dark:text-gray-400 mt-1">{c.text}</p>
                                                <span className="text-xs text-gray-400 mt-1 inline-flex items-center gap-1"><Heart className="w-3 h-3" />{c.likes || 0}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Meta */}
                            <div className="text-xs text-gray-400 flex items-center gap-4 pt-2 border-t border-gray-100 dark:border-gray-800">
                                <span><Clock className="w-3 h-3 inline mr-1" />Creada: {fmtDate(detailJob.createdAt)}</span>
                                <span>ID: {detailJob.id?.slice(0, 8)}...</span>
                            </div>

                            {/* Acciones rápidas desde el detalle */}
                            <div className="flex gap-3 pt-2 border-t border-gray-100 dark:border-gray-700">
                                <Button variant="outline" onClick={() => { setDetailJob(null); handleEdit(detailJob); }}>
                                    <Pencil className="w-4 h-4 mr-1" /> Editar
                                </Button>
                                <button
                                    onClick={() => handleToggleActive(detailJob)}
                                    className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all ${detailJob.active !== false ? 'bg-gray-100 text-gray-600 hover:bg-red-50 hover:text-red-600' : 'bg-green-50 text-green-600 hover:bg-green-100'}`}
                                >
                                    {detailJob.active !== false ? 'Pausar' : 'Publicar'}
                                </button>
                            </div>
                        </div>
                    );
                })()}
            </Modal>

            {/* Modal Crear/Editar */}
            <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editingJob ? "Editar Vacante" : "Nueva Vacante App"}>
                <div className="space-y-4">
                    <Input label="Título del Puesto *" value={formData.title} onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))} placeholder="Ej. Gerente de Ventas" />
                    <Input label="Empresa *" value={formData.company} onChange={(e) => setFormData(prev => ({ ...prev, company: e.target.value }))} placeholder="Ej. TechCorp" />
                    <div className="grid grid-cols-2 gap-4">
                        <Input label="Ubicación" value={formData.location} onChange={(e) => setFormData(prev => ({ ...prev, location: e.target.value }))} placeholder="Ej. Monterrey / Remoto" />
                        <Input label="Sueldo" value={formData.salary} onChange={(e) => setFormData(prev => ({ ...prev, salary: e.target.value }))} placeholder="Ej. $20k - $30k" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Tipo</label>
                            <select className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white" value={formData.type} onChange={(e) => setFormData(prev => ({ ...prev, type: e.target.value }))}>
                                <option value="Tiempo Completo">Tiempo Completo</option>
                                <option value="Medio Tiempo">Medio Tiempo</option>
                                <option value="Remoto">Remoto</option>
                                <option value="Híbrido">Híbrido</option>
                            </select>
                        </div>
                        <Input label="WhatsApp del Reclutador *" value={formData.recruiterPhone} onChange={(e) => setFormData(prev => ({ ...prev, recruiterPhone: e.target.value }))} placeholder="Ej. 8112345678" />
                    </div>

                    <div className="pt-2 border-t border-gray-100 dark:border-gray-700">
                        <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-1"><ImageIcon className="w-3.5 h-3.5" /> Imágenes (URLs)</p>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <Input label="Logo de Empresa" value={formData.companyLogo} onChange={(e) => setFormData(prev => ({ ...prev, companyLogo: e.target.value }))} placeholder="https://..." />
                                {formData.companyLogo && <img src={formData.companyLogo} alt="" className="w-12 h-12 rounded-lg object-cover border mt-1" />}
                            </div>
                            <div className="space-y-1">
                                <Input label="Imagen de Vacante" value={formData.mediaUrl} onChange={(e) => setFormData(prev => ({ ...prev, mediaUrl: e.target.value }))} placeholder="https://..." />
                                {formData.mediaUrl && <img src={formData.mediaUrl} alt="" className="w-full h-16 rounded-lg object-cover border mt-1" />}
                            </div>
                        </div>
                    </div>

                    <div className="space-y-1">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Descripción</label>
                        <textarea className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white min-h-[120px]" value={formData.description} onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))} placeholder="Requisitos, beneficios, etc." />
                    </div>

                    <div className="flex justify-end gap-3 pt-4 border-t border-gray-100 dark:border-gray-700">
                        <Button variant="outline" onClick={() => setIsModalOpen(false)}>Cancelar</Button>
                        <Button onClick={handleSave} loading={saving}>{saving ? 'Guardando...' : 'Guardar Vacante'}</Button>
                    </div>
                </div>
            </Modal>

            {confirmModalJSX}
        </div>
    );
};

export default BolsaSection;
