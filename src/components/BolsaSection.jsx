import React, { useState, useEffect } from 'react';
import { Briefcase, Plus, Building2, Tag, Loader2, Save, Trash2, Pencil, Power, Smartphone, Image as ImageIcon, MessageSquare, Heart, Users, Clock, Phone, ChevronDown, ChevronUp, X } from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';
import Input from './ui/Input';
import Modal from './ui/Modal';
import { useConfirmModal } from './ui/ConfirmModal';

const BolsaSection = ({ showToast }) => {
    const [jobs, setJobs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [editingJob, setEditingJob] = useState(null);
    const [expandedJob, setExpandedJob] = useState(null);
    const { confirmModalJSX, showConfirm } = useConfirmModal();

    const defaultForm = {
        title: '', company: '', location: '', salary: '',
        type: 'Tiempo Completo', recruiterPhone: '', description: '',
        mediaUrl: '', companyLogo: ''
    };
    const [formData, setFormData] = useState(defaultForm);

    useEffect(() => { loadJobs(); }, []);

    const loadJobs = async () => {
        try {
            const res = await fetch('/api/bolsa');
            const data = await res.json();
            if (data.success) setJobs(data.data || []);
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
                        <p className="text-blue-100 text-sm mt-1">Administra vacantes, comentarios, postulaciones y solicitudes.</p>
                    </div>
                </div>
                <button onClick={handleOpenCreate} className="flex items-center gap-2 px-4 py-2 bg-white text-blue-600 rounded-xl font-bold shadow-sm hover:scale-105 transition-all">
                    <Plus className="w-5 h-5" /> Crear Vacante
                </button>
            </div>

            {/* Jobs List */}
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
                <div className="space-y-4">
                    {jobs.map((job) => {
                        const isExpanded = expandedJob === job.id;
                        const appCount = (job.applications || []).length;
                        const commCount = (job.comments || []).length;
                        const reqCount = (job.requests || []).length;

                        return (
                            <Card key={job.id} className="relative overflow-hidden group hover:shadow-lg transition-all border border-gray-100 dark:border-gray-800">
                                {/* Top Row */}
                                <div className="flex flex-col md:flex-row md:items-start gap-4">
                                    {/* Logo Preview */}
                                    <div className="flex-shrink-0">
                                        {job.companyLogo ? (
                                            <img src={job.companyLogo} alt="" className="w-16 h-16 rounded-xl object-cover border border-gray-200 dark:border-gray-700" />
                                        ) : (
                                            <div className="w-16 h-16 rounded-xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center">
                                                <Building2 className="w-7 h-7 text-blue-500" />
                                            </div>
                                        )}
                                    </div>

                                    {/* Info */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-start justify-between gap-2">
                                            <div>
                                                <h3 className="text-lg font-bold text-gray-900 dark:text-white leading-tight">{job.title}</h3>
                                                <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">{job.company}</p>
                                            </div>
                                            <span className={`px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-widest flex-shrink-0 ${job.active !== false
                                                ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-400'
                                                : 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400'}`}>
                                                {job.active !== false ? 'Pública' : 'Oculta'}
                                            </span>
                                        </div>

                                        {/* Tags Row */}
                                        <div className="flex flex-wrap gap-2 mt-3">
                                            {job.location && <span className="inline-flex items-center gap-1 text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 px-2 py-1 rounded-lg"><Tag className="w-3 h-3" />{job.location}</span>}
                                            {job.salary && <span className="inline-flex items-center gap-1 text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 px-2 py-1 rounded-lg">💰 {job.salary}</span>}
                                            <span className="inline-flex items-center gap-1 text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 px-2 py-1 rounded-lg"><Briefcase className="w-3 h-3" />{job.type}</span>
                                        </div>

                                        {/* Stats Row */}
                                        <div className="flex items-center gap-4 mt-3 text-xs text-gray-500 dark:text-gray-400">
                                            <span className="inline-flex items-center gap-1"><Heart className="w-3.5 h-3.5 text-red-400" />{job.likes || 0} likes</span>
                                            <span className="inline-flex items-center gap-1"><MessageSquare className="w-3.5 h-3.5 text-blue-400" />{commCount} comentarios</span>
                                            <span className="inline-flex items-center gap-1"><Users className="w-3.5 h-3.5 text-green-500" />{appCount} postulaciones</span>
                                            <span className="inline-flex items-center gap-1"><Phone className="w-3.5 h-3.5 text-purple-400" />{reqCount} solicitudes</span>
                                        </div>

                                        {/* Media Preview */}
                                        {job.mediaUrl && (
                                            <div className="mt-3">
                                                <img src={job.mediaUrl} alt="" className="w-full max-h-32 object-cover rounded-xl border border-gray-200 dark:border-gray-700" />
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Actions Bar */}
                                <div className="flex items-center gap-2 mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
                                    <button onClick={() => setExpandedJob(isExpanded ? null : job.id)} className="flex-1 py-2 rounded-lg flex items-center justify-center transition-all bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 text-xs font-bold">
                                        {isExpanded ? <ChevronUp className="w-4 h-4 mr-1" /> : <ChevronDown className="w-4 h-4 mr-1" />}
                                        {isExpanded ? 'Cerrar' : 'Ver Todo'}
                                    </button>
                                    <button onClick={() => handleToggleActive(job)} className={`flex-1 py-2 rounded-lg flex items-center justify-center transition-all ${job.active !== false ? 'bg-gray-100 text-gray-600 hover:bg-red-50 hover:text-red-600' : 'bg-green-50 text-green-600 hover:bg-green-100'}`}>
                                        <Power className="w-4 h-4 mr-1.5" />
                                        <span className="text-xs font-bold">{job.active !== false ? 'Pausar' : 'Publicar'}</span>
                                    </button>
                                    <button onClick={() => handleEdit(job)} className="p-2 bg-gray-100 text-gray-600 hover:bg-blue-50 hover:text-blue-600 rounded-lg transition-all"><Pencil className="w-4 h-4" /></button>
                                    <button onClick={() => handleDelete(job.id)} className="p-2 bg-gray-100 text-gray-600 hover:bg-red-50 hover:text-red-600 rounded-lg transition-all"><Trash2 className="w-4 h-4" /></button>
                                </div>

                                {/* Expanded Detail */}
                                {isExpanded && (
                                    <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800 space-y-6 animate-in fade-in duration-300">
                                        {/* Description */}
                                        {job.description && (
                                            <div>
                                                <h4 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">📝 Descripción</h4>
                                                <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap leading-relaxed">{job.description}</p>
                                            </div>
                                        )}

                                        {/* Applications */}
                                        <div>
                                            <h4 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2">
                                                <Users className="w-4 h-4 text-green-500" /> Postulaciones ({appCount})
                                            </h4>
                                            {appCount === 0 ? (
                                                <p className="text-xs text-gray-400 italic">Sin postulaciones aún</p>
                                            ) : (
                                                <div className="space-y-2 max-h-48 overflow-y-auto">
                                                    {(job.applications || []).map(app => (
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

                                        {/* Contact Requests */}
                                        <div>
                                            <h4 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2">
                                                <Phone className="w-4 h-4 text-purple-500" /> Solicitudes de Contacto ({reqCount})
                                            </h4>
                                            {reqCount === 0 ? (
                                                <p className="text-xs text-gray-400 italic">Sin solicitudes aún</p>
                                            ) : (
                                                <div className="space-y-2 max-h-48 overflow-y-auto">
                                                    {(job.requests || []).map(r => (
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

                                        {/* Comments */}
                                        <div>
                                            <h4 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2">
                                                <MessageSquare className="w-4 h-4 text-blue-500" /> Comentarios ({commCount})
                                            </h4>
                                            {commCount === 0 ? (
                                                <p className="text-xs text-gray-400 italic">Sin comentarios aún</p>
                                            ) : (
                                                <div className="space-y-2 max-h-60 overflow-y-auto">
                                                    {(job.comments || []).map(c => (
                                                        <div key={c.id} className="bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2 text-sm group/comment">
                                                            <div className="flex items-center justify-between">
                                                                <div className="flex items-center gap-2">
                                                                    <span className="font-bold text-gray-900 dark:text-white">{c.user}</span>
                                                                    <span className="text-xs text-gray-400">{fmtDate(c.createdAt)}</span>
                                                                </div>
                                                                <button onClick={() => handleDeleteComment(job.id, c.id)} className="opacity-0 group-hover/comment:opacity-100 p-1 hover:bg-red-50 rounded transition-all">
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

                                        {/* Meta Info */}
                                        <div className="text-xs text-gray-400 flex items-center gap-4 pt-2 border-t border-gray-100 dark:border-gray-800">
                                            <span><Clock className="w-3 h-3 inline mr-1" />Creada: {fmtDate(job.createdAt)}</span>
                                            <span>ID: {job.id?.slice(0, 8)}...</span>
                                        </div>
                                    </div>
                                )}
                            </Card>
                        );
                    })}
                </div>
            )}

            {/* Create/Edit Modal */}
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

                    {/* NEW: Image fields */}
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
