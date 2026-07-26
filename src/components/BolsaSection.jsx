import React, { useState, useEffect, useRef } from 'react';
import {
    Briefcase, Plus, Building2, Tag, Loader2, Trash2, Pencil, Power,
    Smartphone, Image as ImageIcon, MessageSquare, Heart, Users, Clock,
    Phone, X, Eye, ChevronDown, Building, PhoneCall, MessagesSquare, Upload,
} from 'lucide-react';
import Button from './ui/Button';
import Input from './ui/Input';
import Modal from './ui/Modal';
import { useConfirmModal } from './ui/ConfirmModal';

// ── Subidor de imagen ────────────────────────────────────────────────────────
function ImageUploader({ label, value, onChange }) {
    const inputRef = useRef(null);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState('');

    const handleFile = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) { setError('Solo se aceptan imágenes'); return; }
        if (file.size > 4 * 1024 * 1024) { setError('Máximo 4 MB'); return; }
        setError('');
        setUploading(true);
        try {
            const fd = new FormData();
            fd.append('file', file);
            const res = await fetch('/api/bolsa-upload', { method: 'POST', body: fd });
            const data = await res.json();
            if (data.success) {
                onChange(data.url);
            } else {
                setError(data.error || 'Error al subir');
            }
        } catch {
            setError('Error de conexión');
        } finally {
            setUploading(false);
            e.target.value = '';
        }
    };

    return (
        <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>
            <div className="flex items-center gap-3">
                {value ? (
                    <div className="relative flex-shrink-0">
                        <img src={value} alt="" className="w-16 h-16 rounded-xl object-cover border border-gray-200 dark:border-gray-600" />
                        <button
                            type="button"
                            onClick={() => onChange('')}
                            className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 transition-colors"
                        >
                            <X className="w-3 h-3" />
                        </button>
                    </div>
                ) : (
                    <div className="w-16 h-16 rounded-xl bg-gray-100 dark:bg-gray-700 border-2 border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center flex-shrink-0">
                        <ImageIcon className="w-6 h-6 text-gray-400" />
                    </div>
                )}
                <div className="flex-1">
                    <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
                    <button
                        type="button"
                        onClick={() => inputRef.current?.click()}
                        disabled={uploading}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-700 rounded-xl text-sm font-semibold hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-all disabled:opacity-50"
                    >
                        {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                        {uploading ? 'Subiendo...' : value ? 'Cambiar imagen' : 'Subir imagen'}
                    </button>
                    {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
                    {!error && <p className="text-xs text-gray-400 mt-1">JPG, PNG, GIF · máx 4 MB</p>}
                </div>
            </div>
        </div>
    );
}
import { useToastContext } from '../contexts/ToastContext';

const PAGE_SIZE = 12;

// ── Tarjeta de candidato postulado ──────────────────────────────────────────
function ApplicantCard({ app }) {
    const p = app.profile || {};
    const initials = (app.candidateName || 'C').slice(0, 2).toUpperCase();
    const [photoOk, setPhotoOk] = React.useState(!!p.foto);

    // La foto puede ser un URI local del teléfono — no accesible desde el dashboard
    const isLocalUri = p.foto && (p.foto.startsWith('file://') || p.foto.startsWith('content://') || p.foto.startsWith('ph://'));

    return (
        <div className="flex items-start gap-3 bg-green-50 dark:bg-green-900/20 rounded-xl px-3 py-2.5">
            {p.foto && photoOk && !isLocalUri ? (
                <img
                    src={p.foto}
                    alt=""
                    className="w-10 h-10 rounded-full object-cover flex-shrink-0 border-2 border-green-200"
                    onError={() => setPhotoOk(false)}
                />
            ) : (
                <div className="w-10 h-10 rounded-full bg-green-200 dark:bg-green-800 flex items-center justify-center flex-shrink-0 text-green-800 dark:text-green-200 font-bold text-sm flex-shrink-0">
                    {initials}
                </div>
            )}
            <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-gray-900 dark:text-white text-sm truncate">{app.candidateName}</span>
                    <span className="text-xs text-gray-400 flex-shrink-0">{fmtDate(app.createdAt)}</span>
                </div>
                <span className="text-xs text-gray-500">{app.candidatePhone}</span>
                <div className="flex flex-wrap gap-1 mt-1.5">
                    {p.municipio   && <span className="text-[10px] bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 px-1.5 py-0.5 rounded-md text-gray-600 dark:text-gray-300">📍 {p.municipio}</span>}
                    {p.categoria   && <span className="text-[10px] bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 px-1.5 py-0.5 rounded-md text-gray-600 dark:text-gray-300">💼 {p.categoria}</span>}
                    {p.escolaridad && <span className="text-[10px] bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 px-1.5 py-0.5 rounded-md text-gray-600 dark:text-gray-300">🎓 {p.escolaridad}</span>}
                    {p.genero      && <span className="text-[10px] bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 px-1.5 py-0.5 rounded-md text-gray-600 dark:text-gray-300">{p.genero}</span>}
                    {p.cvNombre    && <span className="text-[10px] bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-700 px-1.5 py-0.5 rounded-md text-orange-600 dark:text-orange-400">📄 {p.cvNombre}</span>}
                </div>
            </div>
        </div>
    );
}

const fmtDate = (d) => {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

// ── Tab Vacantes ─────────────────────────────────────────────────────────────
function TabVacantes({ empresas }) {
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
        empresaId: '', title: '', company: '', location: '', salary: '',
        type: 'Tiempo Completo', recruiterPhone: '', description: '',
        mediaUrl: '', companyLogo: '',
    };
    const [formData, setFormData] = useState(defaultForm);

    useEffect(() => { loadJobs(); }, []);

    useEffect(() => {
        const el = sentinelRef.current;
        if (!el) return;
        const obs = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting) setVisibleCount(p => Math.min(p + PAGE_SIZE, jobs.length));
        }, { threshold: 0.1 });
        obs.observe(el);
        return () => obs.disconnect();
    }, [jobs.length]);

    const loadJobs = async () => {
        try {
            const res = await fetch('/api/bolsa');
            const data = await res.json();
            if (data.success) { setJobs(data.data || []); setVisibleCount(PAGE_SIZE); }
        } catch { showToast('Error al cargar vacantes', 'error'); }
        finally { setLoading(false); }
    };

    const handleOpenCreate = () => { setEditingJob(null); setFormData(defaultForm); setIsModalOpen(true); };

    const handleEdit = (job) => {
        setEditingJob(job);
        setFormData({
            empresaId: '', title: job.title || '', company: job.company || '',
            location: job.location || '', salary: job.salary || '',
            type: job.type || 'Tiempo Completo', recruiterPhone: job.recruiterPhone || '',
            description: job.description || '', mediaUrl: job.mediaUrl || '',
            companyLogo: job.companyLogo || '',
        });
        setIsModalOpen(true);
    };

    const handleSelectEmpresa = (id) => {
        const emp = empresas.find(e => e.id === id);
        if (!emp) { setFormData(p => ({ ...p, empresaId: '' })); return; }
        setFormData(p => ({
            ...p, empresaId: id,
            company: emp.nombre,
            companyLogo: emp.logo,
            recruiterPhone: emp.telefono,
        }));
    };

    const handleSave = async () => {
        if (!formData.title || !formData.company || !formData.recruiterPhone) {
            showToast('Título, empresa y teléfono son obligatorios', 'error'); return;
        }
        setSaving(true);
        try {
            const isEditing = !!editingJob;
            const body = isEditing ? { ...formData, id: editingJob.id } : formData;
            const res = await fetch('/api/bolsa', {
                method: isEditing ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await res.json();
            if (data.success) {
                showToast(isEditing ? 'Vacante actualizada' : 'Vacante creada', 'success');
                setIsModalOpen(false); loadJobs();
            } else { showToast(data.error || 'Error al guardar', 'error'); }
        } catch { showToast('Error de conexión', 'error'); }
        finally { setSaving(false); }
    };

    const handleToggleActive = async (job) => {
        try {
            const res = await fetch('/api/bolsa', {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: job.id, active: !job.active }),
            });
            if (res.ok) { showToast(job.active !== false ? 'Vacante pausada' : 'Vacante activada', 'success'); loadJobs(); }
        } catch { showToast('Error al actualizar', 'error'); }
    };

    const handleDelete = async (id) => {
        const ok = await showConfirm({ title: 'Eliminar Vacante', message: '¿Seguro que deseas eliminar esta vacante?', confirmText: 'Eliminar', cancelText: 'Cancelar', variant: 'danger' });
        if (!ok) return;
        try {
            const res = await fetch(`/api/bolsa?id=${id}`, { method: 'DELETE' });
            if (res.ok) { showToast('Vacante eliminada', 'success'); loadJobs(); }
        } catch { showToast('Error al eliminar', 'error'); }
    };

    const handleDeleteComment = async (jobId, commentId) => {
        const ok = await showConfirm({ title: 'Eliminar Comentario', message: '¿Seguro?', confirmText: 'Eliminar', cancelText: 'Cancelar', variant: 'danger' });
        if (!ok) return;
        try {
            await fetch('/api/bolsa?action=deleteComment', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jobId, commentId }),
            });
            showToast('Comentario eliminado', 'success'); loadJobs();
        } catch { showToast('Error al eliminar comentario', 'error'); }
    };

    const visibleJobs = jobs.slice(0, visibleCount);

    return (
        <>
            {/* Barra de acciones */}
            <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                    {jobs.length} vacante{jobs.length !== 1 ? 's' : ''} · mostrando {Math.min(visibleCount, jobs.length)}
                </p>
                <button onClick={handleOpenCreate} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl font-bold shadow-sm hover:bg-blue-700 transition-all text-sm">
                    <Plus className="w-4 h-4" /> Nueva Vacante
                </button>
            </div>

            {loading ? (
                <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>
            ) : jobs.length === 0 ? (
                <div className="text-center py-16 text-gray-400">
                    <Smartphone className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p className="font-medium">Sin vacantes publicadas</p>
                    <button onClick={handleOpenCreate} className="mt-4 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-xl text-sm hover:bg-gray-50 dark:hover:bg-gray-800 transition-all">Crear primera vacante</button>
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                        {visibleJobs.map((job) => {
                            const appCount = (job.applications || []).length;
                            const commCount = (job.comments || []).length;
                            const callCount = (job.requests || []).filter(r => r.requestType === 'call').length;
                            const waCount = (job.requests || []).filter(r => r.requestType === 'whatsapp').length;
                            const isActive = job.active !== false;
                            return (
                                <div key={job.id} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 flex flex-col overflow-hidden hover:shadow-lg transition-all">
                                    {job.mediaUrl ? (
                                        <div className="relative h-28 flex-shrink-0">
                                            <img src={job.mediaUrl} alt="" className="w-full h-full object-cover" />
                                            <span className={`absolute top-2 right-2 px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${isActive ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}`}>
                                                {isActive ? 'Pública' : 'Oculta'}
                                            </span>
                                        </div>
                                    ) : (
                                        <div className="h-16 bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-blue-900/20 dark:to-indigo-900/20 flex items-center justify-center relative flex-shrink-0">
                                            <Briefcase className="w-7 h-7 text-blue-300" />
                                            <span className={`absolute top-2 right-2 px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${isActive ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}`}>
                                                {isActive ? 'Pública' : 'Oculta'}
                                            </span>
                                        </div>
                                    )}
                                    <div className="p-3 flex flex-col flex-1 gap-2">
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
                                        <div className="flex flex-wrap gap-1">
                                            {job.location && <span className="text-[10px] bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded-md truncate max-w-full">📍 {job.location}</span>}
                                            {job.salary && <span className="text-[10px] bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded-md">💰 {job.salary}</span>}
                                        </div>
                                        {/* Stats: postulaciones / comentarios / me llamen / me escriban */}
                                        <div className="grid grid-cols-2 gap-1 mt-auto">
                                            <span className="flex items-center gap-0.5 text-[10px] text-gray-400"><Users className="w-3 h-3 text-green-500" />{appCount} post.</span>
                                            <span className="flex items-center gap-0.5 text-[10px] text-gray-400"><MessageSquare className="w-3 h-3 text-blue-400" />{commCount} com.</span>
                                            <span className="flex items-center gap-0.5 text-[10px] text-gray-400"><PhoneCall className="w-3 h-3 text-purple-400" />{callCount} llamen</span>
                                            <span className="flex items-center gap-0.5 text-[10px] text-gray-400"><MessagesSquare className="w-3 h-3 text-cyan-400" />{waCount} escriban</span>
                                        </div>
                                        <div className="flex items-center gap-1 pt-2 border-t border-gray-100 dark:border-gray-700">
                                            <button onClick={() => setDetailJob(job)} className="flex-1 py-1.5 rounded-lg text-[11px] font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 transition-all flex items-center justify-center gap-1">
                                                <Eye className="w-3 h-3" /> Ver
                                            </button>
                                            <button onClick={() => handleToggleActive(job)} className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold transition-all ${isActive ? 'text-gray-600 bg-gray-100 hover:bg-red-50 hover:text-red-600 dark:bg-gray-700 dark:text-gray-300' : 'text-green-600 bg-green-50 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400'}`}>
                                                {isActive ? 'Pausar' : 'Activar'}
                                            </button>
                                            <button onClick={() => handleEdit(job)} className="p-1.5 bg-gray-100 dark:bg-gray-700 text-gray-500 hover:bg-blue-50 hover:text-blue-600 rounded-lg transition-all"><Pencil className="w-3.5 h-3.5" /></button>
                                            <button onClick={() => handleDelete(job.id)} className="p-1.5 bg-gray-100 dark:bg-gray-700 text-gray-500 hover:bg-red-50 hover:text-red-600 rounded-lg transition-all"><Trash2 className="w-3.5 h-3.5" /></button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    {visibleCount < jobs.length && (
                        <div ref={sentinelRef} className="flex justify-center py-6">
                            <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
                        </div>
                    )}
                </>
            )}

            {/* ── Modal Detalle ── */}
            <Modal isOpen={!!detailJob} onClose={() => setDetailJob(null)} title={detailJob?.title || 'Detalle'}>
                {detailJob && (() => {
                    const apps = detailJob.applications || [];
                    const comms = detailJob.comments || [];
                    const llamadas = (detailJob.requests || []).filter(r => r.requestType === 'call');
                    const whatsapps = (detailJob.requests || []).filter(r => r.requestType === 'whatsapp');
                    return (
                        <div className="space-y-6">
                            {/* Info */}
                            <div className="flex items-start gap-4">
                                {detailJob.companyLogo ? (
                                    <img src={detailJob.companyLogo} alt="" className="w-14 h-14 rounded-xl object-cover border border-gray-200 dark:border-gray-700 flex-shrink-0" />
                                ) : (
                                    <div className="w-14 h-14 rounded-xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                                        <Building2 className="w-7 h-7 text-blue-500" />
                                    </div>
                                )}
                                <div className="flex-1 min-w-0">
                                    <p className="text-gray-500 text-sm">{detailJob.company}</p>
                                    <div className="flex flex-wrap gap-1.5 mt-2">
                                        {detailJob.location && <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-1 rounded-lg">📍 {detailJob.location}</span>}
                                        {detailJob.salary && <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-1 rounded-lg">💰 {detailJob.salary}</span>}
                                        <span className="text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-2 py-1 rounded-lg">{detailJob.type}</span>
                                    </div>
                                </div>
                                <span className={`px-2 py-1 rounded-md text-[10px] font-black uppercase flex-shrink-0 ${detailJob.active !== false ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                    {detailJob.active !== false ? 'Pública' : 'Oculta'}
                                </span>
                            </div>

                            {detailJob.mediaUrl && <img src={detailJob.mediaUrl} alt="" className="w-full max-h-48 object-cover rounded-xl border border-gray-200 dark:border-gray-700" />}
                            {detailJob.description && (
                                <div>
                                    <h4 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">📝 Descripción</h4>
                                    <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap leading-relaxed">{detailJob.description}</p>
                                </div>
                            )}

                            {/* ── Postulaciones ── */}
                            <div>
                                <h4 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                                    <Users className="w-4 h-4 text-green-500" />
                                    Postulaciones
                                    <span className="ml-auto bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 text-xs font-black px-2 py-0.5 rounded-full">{apps.length}</span>
                                </h4>
                                {apps.length === 0 ? (
                                    <p className="text-xs text-gray-400 italic">Sin postulaciones aún</p>
                                ) : (
                                    <div className="space-y-2 max-h-56 overflow-y-auto">
                                        {apps.map(app => <ApplicantCard key={app.id} app={app} />)}
                                    </div>
                                )}
                            </div>

                            {/* ── Me llamen ── */}
                            <div>
                                <h4 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                                    <PhoneCall className="w-4 h-4 text-purple-500" />
                                    Me llamen
                                    <span className="ml-auto bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-400 text-xs font-black px-2 py-0.5 rounded-full">{llamadas.length}</span>
                                </h4>
                                {llamadas.length === 0 ? (
                                    <p className="text-xs text-gray-400 italic">Sin solicitudes de llamada</p>
                                ) : (
                                    <div className="space-y-2 max-h-40 overflow-y-auto">
                                        {llamadas.map(r => (
                                            <div key={r.id} className="flex items-center justify-between bg-purple-50 dark:bg-purple-900/20 rounded-xl px-3 py-2.5">
                                                <div>
                                                    <span className="font-bold text-gray-900 dark:text-white text-sm">{r.candidateName}</span>
                                                    <span className="text-gray-500 text-xs ml-2">{r.candidatePhone}</span>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-xs text-purple-600 font-semibold">⏰ {r.timePreference}</p>
                                                    <p className="text-xs text-gray-400">{fmtDate(r.createdAt)}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* ── Me escriban ── */}
                            <div>
                                <h4 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                                    <MessagesSquare className="w-4 h-4 text-cyan-500" />
                                    Me escriban por WhatsApp
                                    <span className="ml-auto bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-400 text-xs font-black px-2 py-0.5 rounded-full">{whatsapps.length}</span>
                                </h4>
                                {whatsapps.length === 0 ? (
                                    <p className="text-xs text-gray-400 italic">Sin solicitudes de WhatsApp</p>
                                ) : (
                                    <div className="space-y-2 max-h-40 overflow-y-auto">
                                        {whatsapps.map(r => (
                                            <div key={r.id} className="flex items-center justify-between bg-cyan-50 dark:bg-cyan-900/20 rounded-xl px-3 py-2.5">
                                                <div>
                                                    <span className="font-bold text-gray-900 dark:text-white text-sm">{r.candidateName}</span>
                                                    <span className="text-gray-500 text-xs ml-2">{r.candidatePhone}</span>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-xs text-cyan-600 font-semibold">⏰ {r.timePreference}</p>
                                                    <p className="text-xs text-gray-400">{fmtDate(r.createdAt)}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* ── Comentarios ── */}
                            <div>
                                <h4 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                                    <MessageSquare className="w-4 h-4 text-blue-500" />
                                    Comentarios
                                    <span className="ml-auto bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400 text-xs font-black px-2 py-0.5 rounded-full">{comms.length}</span>
                                </h4>
                                {comms.length === 0 ? (
                                    <p className="text-xs text-gray-400 italic">Sin comentarios</p>
                                ) : (
                                    <div className="space-y-2 max-h-52 overflow-y-auto">
                                        {comms.map(c => (
                                            <div key={c.id} className="bg-gray-50 dark:bg-gray-800 rounded-xl px-3 py-2 text-sm group/comment">
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

                            <div className="text-xs text-gray-400 flex gap-4 pt-2 border-t border-gray-100 dark:border-gray-800">
                                <span><Clock className="w-3 h-3 inline mr-1" />Creada: {fmtDate(detailJob.createdAt)}</span>
                                <span>ID: {detailJob.id?.slice(0, 8)}...</span>
                            </div>
                            <div className="flex gap-3 pt-2 border-t border-gray-100 dark:border-gray-700">
                                <Button variant="outline" onClick={() => { setDetailJob(null); handleEdit(detailJob); }}>
                                    <Pencil className="w-4 h-4 mr-1" /> Editar
                                </Button>
                                <button onClick={() => handleToggleActive(detailJob)} className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all ${detailJob.active !== false ? 'bg-gray-100 text-gray-600 hover:bg-red-50 hover:text-red-600' : 'bg-green-50 text-green-600 hover:bg-green-100'}`}>
                                    {detailJob.active !== false ? 'Pausar' : 'Publicar'}
                                </button>
                            </div>
                        </div>
                    );
                })()}
            </Modal>

            {/* ── Modal Crear/Editar ── */}
            <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editingJob ? 'Editar Vacante' : 'Nueva Vacante'}>
                <div className="space-y-4">
                    {/* Selector de empresa */}
                    {empresas.length > 0 && (
                        <div className="space-y-1">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                Seleccionar empresa registrada
                            </label>
                            <select
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                value={formData.empresaId}
                                onChange={e => handleSelectEmpresa(e.target.value)}
                            >
                                <option value="">— Seleccionar o llenar manualmente —</option>
                                {empresas.map(e => (
                                    <option key={e.id} value={e.id}>{e.nombre} · {e.telefono}</option>
                                ))}
                            </select>
                        </div>
                    )}
                    <div className="pt-1 border-t border-gray-100 dark:border-gray-700" />
                    <Input label="Título del Puesto *" value={formData.title} onChange={e => setFormData(p => ({ ...p, title: e.target.value }))} placeholder="Ej. Gerente de Ventas" />
                    <Input label="Empresa *" value={formData.company} onChange={e => setFormData(p => ({ ...p, company: e.target.value }))} placeholder="Ej. TechCorp" />
                    <div className="grid grid-cols-2 gap-4">
                        <Input label="Ubicación" value={formData.location} onChange={e => setFormData(p => ({ ...p, location: e.target.value }))} placeholder="Ej. Monterrey" />
                        <Input label="Sueldo" value={formData.salary} onChange={e => setFormData(p => ({ ...p, salary: e.target.value }))} placeholder="Ej. $20k-$30k" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Tipo</label>
                            <select className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white" value={formData.type} onChange={e => setFormData(p => ({ ...p, type: e.target.value }))}>
                                <option>Tiempo Completo</option>
                                <option>Medio Tiempo</option>
                                <option>Remoto</option>
                                <option>Híbrido</option>
                            </select>
                        </div>
                        <Input label="WhatsApp Reclutador *" value={formData.recruiterPhone} onChange={e => setFormData(p => ({ ...p, recruiterPhone: e.target.value }))} placeholder="Ej. 8112345678" />
                    </div>
                    <div className="pt-2 border-t border-gray-100 dark:border-gray-700 space-y-4">
                        <ImageUploader
                            label="Logo de Empresa"
                            value={formData.companyLogo}
                            onChange={v => setFormData(p => ({ ...p, companyLogo: v }))}
                        />
                        <ImageUploader
                            label="Imagen de Vacante"
                            value={formData.mediaUrl}
                            onChange={v => setFormData(p => ({ ...p, mediaUrl: v }))}
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Descripción</label>
                        <textarea className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white min-h-[100px]" value={formData.description} onChange={e => setFormData(p => ({ ...p, description: e.target.value }))} placeholder="Requisitos, beneficios, etc." />
                    </div>
                    <div className="flex justify-end gap-3 pt-4 border-t border-gray-100 dark:border-gray-700">
                        <Button variant="outline" onClick={() => setIsModalOpen(false)}>Cancelar</Button>
                        <Button onClick={handleSave} loading={saving}>{saving ? 'Guardando...' : 'Guardar Vacante'}</Button>
                    </div>
                </div>
            </Modal>

            {confirmModalJSX}
        </>
    );
}

// ── Tab Empresas ─────────────────────────────────────────────────────────────
function TabEmpresas({ onEmpresasChange }) {
    const [empresas, setEmpresas] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [editingEmp, setEditingEmp] = useState(null);
    const [detailEmp, setDetailEmp] = useState(null);
    const [form, setForm] = useState({ nombre: '', logo: '', telefono: '' });
    const { confirmModalJSX, showConfirm } = useConfirmModal();
    const { showToast } = useToastContext();

    const fmtDT = (d) => {
        if (!d) return '—';
        try {
            return new Date(d).toLocaleString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        } catch { return '—'; }
    };

    useEffect(() => { loadEmpresas(); }, []);

    const loadEmpresas = async () => {
        try {
            const res = await fetch('/api/empresas');
            const data = await res.json();
            if (data.success) { setEmpresas(data.data || []); onEmpresasChange(data.data || []); }
        } catch { showToast('Error al cargar empresas', 'error'); }
        finally { setLoading(false); }
    };

    const handleOpen = (emp = null) => {
        setEditingEmp(emp);
        setForm(emp ? { nombre: emp.nombre, logo: emp.logo, telefono: emp.telefono } : { nombre: '', logo: '', telefono: '' });
        setIsModalOpen(true);
    };

    const handleSave = async () => {
        if (!form.nombre || !form.telefono) { showToast('Nombre y teléfono son obligatorios', 'error'); return; }
        setSaving(true);
        try {
            const res = await fetch('/api/empresas', {
                method: editingEmp ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(editingEmp ? { id: editingEmp.id, ...form } : form),
            });
            const data = await res.json();
            if (data.success) {
                showToast(editingEmp ? 'Empresa actualizada' : 'Empresa creada', 'success');
                setIsModalOpen(false); loadEmpresas();
            } else { showToast(data.error || 'Error al guardar', 'error'); }
        } catch { showToast('Error de conexión', 'error'); }
        finally { setSaving(false); }
    };

    const handleDelete = async (id) => {
        const ok = await showConfirm({ title: 'Eliminar Empresa', message: '¿Seguro que deseas eliminar esta empresa?', confirmText: 'Eliminar', cancelText: 'Cancelar', variant: 'danger' });
        if (!ok) return;
        try {
            const res = await fetch(`/api/empresas?id=${id}`, { method: 'DELETE' });
            if (res.ok) { showToast('Empresa eliminada', 'success'); loadEmpresas(); }
        } catch { showToast('Error al eliminar', 'error'); }
    };

    const handleStatus = async (id, status) => {
        try {
            const res = await fetch('/api/empresas', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, status }),
            });
            const data = await res.json();
            if (data.success) {
                showToast(status === 'activo' ? 'Empresa activada — sus vacantes se activaron' : 'Empresa pausada — sus vacantes se pausaron', 'success');
                loadEmpresas();
            } else { showToast(data.error || 'Error al cambiar estatus', 'error'); }
        } catch { showToast('Error de conexión', 'error'); }
    };

    return (
        <>
            <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-gray-500 dark:text-gray-400">{empresas.length} empresa{empresas.length !== 1 ? 's' : ''} registrada{empresas.length !== 1 ? 's' : ''}</p>
                <button onClick={() => handleOpen()} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl font-bold shadow-sm hover:bg-blue-700 transition-all text-sm">
                    <Plus className="w-4 h-4" /> Nueva Empresa
                </button>
            </div>

            {loading ? (
                <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>
            ) : empresas.length === 0 ? (
                <div className="text-center py-16 text-gray-400">
                    <Building className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p className="font-medium">Sin empresas registradas</p>
                    <p className="text-sm mt-1">Agrega empresas para usarlas al crear vacantes</p>
                    <button onClick={() => handleOpen()} className="mt-4 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-xl text-sm hover:bg-gray-50 dark:hover:bg-gray-800 transition-all">Agregar primera empresa</button>
                </div>
            ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                    {empresas.map(emp => {
                    const status = emp.status === 'pausado' ? 'pausado' : 'activo';
                    return (
                        <div key={emp.id} className={`bg-white dark:bg-gray-800 rounded-2xl border p-4 flex flex-col items-center gap-3 hover:shadow-lg transition-all group ${status === 'pausado' ? 'border-amber-300 dark:border-amber-700/60' : 'border-gray-100 dark:border-gray-700'}`}>
                            {emp.logo ? (
                                <img src={emp.logo} alt="" className="w-16 h-16 rounded-2xl object-cover border border-gray-200 dark:border-gray-600" />
                            ) : (
                                <div className="w-16 h-16 rounded-2xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center">
                                    <Building className="w-8 h-8 text-blue-400" />
                                </div>
                            )}
                            <div className="text-center min-w-0 w-full">
                                <h3 className="font-bold text-gray-900 dark:text-white text-sm truncate">{emp.nombre}</h3>
                                <p className="text-xs text-gray-500 mt-0.5 flex items-center justify-center gap-1">
                                    <Phone className="w-3 h-3" />{emp.telefono}
                                </p>
                            </div>
                            {/* Estatus de la empresa (controla el default de sus vacantes) */}
                            <select
                                value={status}
                                onChange={e => handleStatus(emp.id, e.target.value)}
                                className={`w-full text-[11px] font-bold rounded-lg py-1.5 px-2 border cursor-pointer text-center appearance-none ${status === 'activo' ? 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400' : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400'}`}
                            >
                                <option value="activo">✓ Activa</option>
                                <option value="pausado">⏸ Pausada</option>
                            </select>
                            <div className="flex gap-2 w-full">
                                <button onClick={() => setDetailEmp(emp)} className="flex-1 py-1.5 rounded-lg text-[11px] font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 transition-all">
                                    Ver info
                                </button>
                                <button onClick={() => handleOpen(emp)} className="p-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 rounded-lg transition-all" title="Editar">
                                    <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button onClick={() => handleDelete(emp.id)} className="p-1.5 bg-gray-100 dark:bg-gray-700 text-gray-500 hover:bg-red-50 hover:text-red-600 rounded-lg transition-all" title="Eliminar">
                                    <Trash2 className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </div>
                    ); })}
                </div>
            )}

            <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editingEmp ? 'Editar Empresa' : 'Nueva Empresa'}>
                <div className="space-y-4">
                    <Input label="Nombre de la empresa *" value={form.nombre} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))} placeholder="Ej. TechCorp SA de CV" />
                    <Input label="Teléfono de contacto *" value={form.telefono} onChange={e => setForm(p => ({ ...p, telefono: e.target.value }))} placeholder="Ej. 8112345678" />
                    <ImageUploader
                        label="Logo de la Empresa"
                        value={form.logo}
                        onChange={v => setForm(p => ({ ...p, logo: v }))}
                    />
                    <div className="flex justify-end gap-3 pt-4 border-t border-gray-100 dark:border-gray-700">
                        <Button variant="outline" onClick={() => setIsModalOpen(false)}>Cancelar</Button>
                        <Button onClick={handleSave} loading={saving}>{saving ? 'Guardando...' : 'Guardar Empresa'}</Button>
                    </div>
                </div>
            </Modal>

            {/* Modal: Información completa de la empresa */}
            <Modal isOpen={!!detailEmp} onClose={() => setDetailEmp(null)} title="Información de la empresa">
                {detailEmp && (() => {
                    const status = detailEmp.status === 'pausado' ? 'pausado' : 'activo';
                    return (
                        <div className="space-y-4">
                            <div className="flex items-center gap-3">
                                {detailEmp.logo ? (
                                    <img src={detailEmp.logo} alt="" className="w-16 h-16 rounded-2xl object-cover border border-gray-200 dark:border-gray-600" />
                                ) : (
                                    <div className="w-16 h-16 rounded-2xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center">
                                        <Building className="w-8 h-8 text-blue-400" />
                                    </div>
                                )}
                                <div>
                                    <h3 className="font-bold text-gray-900 dark:text-white text-lg">{detailEmp.nombre}</h3>
                                    <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${status === 'activo' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                                        {status === 'activo' ? '✓ Activa' : '⏸ Pausada'}
                                    </span>
                                </div>
                            </div>
                            <div className="divide-y divide-gray-100 dark:divide-gray-700 border border-gray-100 dark:border-gray-700 rounded-2xl overflow-hidden">
                                {[
                                    { icon: <Phone className="w-4 h-4 text-blue-500" />, label: 'Número de registro', value: detailEmp.telefono || '—' },
                                    { icon: <MessageSquare className="w-4 h-4 text-green-500" />, label: 'WhatsApp (candidatos)', value: detailEmp.wapp || detailEmp.telefono || '—' },
                                    { icon: <Clock className="w-4 h-4 text-gray-400" />, label: 'Fecha de creación', value: fmtDT(detailEmp.createdAt) },
                                    { icon: <Clock className="w-4 h-4 text-gray-400" />, label: 'Último acceso', value: fmtDT(detailEmp.lastLogin) },
                                ].map((row, i) => (
                                    <div key={i} className="flex items-center justify-between px-4 py-3 bg-white dark:bg-gray-800">
                                        <span className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">{row.icon}{row.label}</span>
                                        <span className="text-sm font-bold text-gray-900 dark:text-white">{row.value}</span>
                                    </div>
                                ))}
                            </div>
                            <div className="flex justify-end pt-2">
                                <Button variant="outline" onClick={() => setDetailEmp(null)}>Cerrar</Button>
                            </div>
                        </div>
                    );
                })()}
            </Modal>

            {confirmModalJSX}
        </>
    );
}

// ── Componente principal ─────────────────────────────────────────────────────
const BolsaSection = () => {
    const [tab, setTab] = useState('vacantes');
    const [empresas, setEmpresas] = useState([]);

    return (
        <div className="space-y-4 w-full pb-8">
            {/* Header */}
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-3xl shadow-lg p-6 flex flex-col md:flex-row items-center justify-between gap-4 text-white">
                <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
                        <Smartphone className="w-6 h-6 text-white" />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold uppercase tracking-tight">Bolsa de Empleo (APP)</h2>
                        <p className="text-blue-100 text-sm mt-1">Vacantes, postulaciones y directorio de empresas.</p>
                    </div>
                </div>
                {/* Tabs */}
                <div className="flex gap-2 bg-white/10 rounded-2xl p-1">
                    <button
                        onClick={() => setTab('vacantes')}
                        className={`px-5 py-2 rounded-xl font-bold text-sm transition-all ${tab === 'vacantes' ? 'bg-white text-blue-700 shadow' : 'text-white/80 hover:text-white'}`}
                    >
                        Vacantes
                    </button>
                    <button
                        onClick={() => setTab('empresas')}
                        className={`px-5 py-2 rounded-xl font-bold text-sm transition-all ${tab === 'empresas' ? 'bg-white text-blue-700 shadow' : 'text-white/80 hover:text-white'}`}
                    >
                        Empresas
                    </button>
                </div>
            </div>

            {tab === 'vacantes'
                ? <TabVacantes empresas={empresas} />
                : <TabEmpresas onEmpresasChange={setEmpresas} />
            }
        </div>
    );
};

export default BolsaSection;
