import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import {
    Briefcase, Plus, Building2, Tag, Loader2, Trash2, Pencil, Power,
    Smartphone, Image as ImageIcon, MessageSquare, Heart, Users, Clock,
    Phone, X, Eye, ChevronDown, Building, PhoneCall, MessagesSquare, Upload,
    MapPin, Wallet, Send, ChevronLeft, Share2, Bookmark, Smile, Sparkles,
} from 'lucide-react';
import Button from './ui/Button';
import Input from './ui/Input';
import Modal from './ui/Modal';
import { useConfirmModal } from './ui/ConfirmModal';
import { candidaticEmojiPickerProps } from '../utils/candidaticEmoji';
const EmojiPicker = lazy(() => import('emoji-picker-react'));

// ── Subidor de imagen ────────────────────────────────────────────────────────
function ImageUploader({ label, value, onChange, hint = 'JPG, PNG, GIF · máx 4 MB' }) {
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
                    {!error && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
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

// Cachés stale-while-revalidate a nivel de módulo → re-entrar a Bolsa pinta las listas al
// instante (sin skeleton ni salto) y revalida en silencio. Ver docs/anti-brinco-secciones.md.
let bolsaJobsCache = null;
let bolsaEmpresasCache = null;

// ── Vista previa en vivo: mockup de celular con la tarjeta de la vacante ──────
// Renderiza EXACTAMENTE lo que el candidato ve en la app, en tiempo real conforme
// se llena el formulario. Siempre en tema claro (es la pantalla del teléfono, no del
// dashboard) para que se vea realista en light y dark mode.
function VacancyPhonePreview({ formData }) {
    const title = (formData.title || '').trim();
    const company = (formData.company || '').trim();
    const location = (formData.location || '').trim();
    const salary = (formData.salary || '').trim();
    const type = (formData.type || '').trim();
    const description = (formData.description || '').trim();
    const { mediaUrl, companyLogo } = formData;

    return (
        <div className="sticky top-0">
            <div className="flex items-center justify-center gap-1.5 mb-3 text-xs font-semibold text-gray-500 dark:text-gray-400">
                <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                </span>
                Vista previa en la app · en vivo
            </div>

            {/* Carcasa del teléfono */}
            <div className="relative mx-auto w-[278px] h-[566px] rounded-[2.9rem] bg-gray-900 dark:bg-black p-2.5 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.45)] ring-1 ring-black/20">
                {/* Botones laterales */}
                <div className="absolute -left-[3px] top-28 w-[3px] h-9 rounded-l bg-gray-700" />
                <div className="absolute -left-[3px] top-40 w-[3px] h-14 rounded-l bg-gray-700" />
                <div className="absolute -right-[3px] top-36 w-[3px] h-16 rounded-r bg-gray-700" />

                {/* Pantalla */}
                <div className="relative w-full h-full rounded-[2.35rem] bg-slate-50 overflow-hidden flex flex-col">
                    {/* Barra de estado + dynamic island */}
                    <div className="relative h-8 bg-white flex items-center justify-between px-6 pt-1.5 flex-shrink-0 z-10">
                        <span className="text-[11px] font-bold text-gray-900">9:41</span>
                        <div className="absolute left-1/2 -translate-x-1/2 top-2 w-[74px] h-[22px] bg-black rounded-full" />
                        <div className="flex items-center gap-1 text-gray-900">
                            <div className="flex items-end gap-[1.5px] h-2.5">
                                <span className="w-[2px] h-1 bg-gray-900 rounded-sm" />
                                <span className="w-[2px] h-1.5 bg-gray-900 rounded-sm" />
                                <span className="w-[2px] h-2 bg-gray-900 rounded-sm" />
                                <span className="w-[2px] h-2.5 bg-gray-900 rounded-sm" />
                            </div>
                            <span className="text-[9px] font-bold ml-0.5">5G</span>
                            <div className="w-5 h-2.5 rounded-[3px] border border-gray-900 relative ml-0.5">
                                <div className="absolute inset-[1.5px] right-1 bg-gray-900 rounded-[1px]" />
                                <div className="absolute -right-[2.5px] top-1/2 -translate-y-1/2 w-[1.5px] h-1 bg-gray-900 rounded-r" />
                            </div>
                        </div>
                    </div>

                    {/* App bar */}
                    <div className="px-3 py-2.5 bg-white border-b border-gray-100 flex items-center gap-2 flex-shrink-0">
                        <ChevronLeft className="w-5 h-5 text-gray-700" />
                        <span className="text-sm font-bold text-gray-900 flex-1">Detalle de vacante</span>
                        <Bookmark className="w-[18px] h-[18px] text-gray-400" />
                        <Share2 className="w-[18px] h-[18px] text-gray-400" />
                    </div>

                    {/* Contenido scrolleable */}
                    <div className="flex-1 overflow-y-auto">
                        {/* Hero */}
                        {mediaUrl ? (
                            <div className="relative h-36 w-full">
                                <img src={mediaUrl} alt="" className="w-full h-full object-cover" />
                                <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
                            </div>
                        ) : (
                            <div className="relative h-36 w-full bg-gradient-to-br from-blue-500 via-indigo-500 to-indigo-600 flex items-center justify-center overflow-hidden">
                                <Briefcase className="w-14 h-14 text-white/30" />
                                <div className="absolute -top-6 -right-6 w-24 h-24 rounded-full bg-white/10" />
                                <div className="absolute -bottom-8 -left-4 w-28 h-28 rounded-full bg-white/10" />
                            </div>
                        )}

                        {/* Tarjeta de info */}
                        <div className="px-4 -mt-9 relative">
                            <div className="w-[66px] h-[66px] rounded-2xl bg-white shadow-md ring-4 ring-white overflow-hidden flex items-center justify-center">
                                {companyLogo ? (
                                    <img src={companyLogo} alt="" className="w-full h-full object-cover" />
                                ) : (
                                    <Building2 className="w-7 h-7 text-blue-400" />
                                )}
                            </div>

                            <h1 className={`mt-3 text-[19px] font-extrabold leading-tight ${title ? 'text-gray-900' : 'text-gray-300'}`}>
                                {title || 'Título del puesto'}
                            </h1>
                            <p className={`mt-0.5 text-sm font-semibold flex items-center gap-1 ${company ? 'text-gray-600' : 'text-gray-300'}`}>
                                <Building2 className="w-3.5 h-3.5 flex-shrink-0" />
                                {company || 'Nombre de la empresa'}
                            </p>

                            {/* Chips */}
                            <div className="flex flex-wrap gap-1.5 mt-3">
                                {location && (
                                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full">
                                        <MapPin className="w-3 h-3" />{location}
                                    </span>
                                )}
                                {salary && (
                                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-green-50 text-green-700 px-2.5 py-1 rounded-full">
                                        <Wallet className="w-3 h-3" />{salary}
                                    </span>
                                )}
                                {type && (
                                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-full">
                                        <Clock className="w-3 h-3" />{type}
                                    </span>
                                )}
                            </div>

                            {/* Métricas sociales (como las ve el candidato) */}
                            <div className="flex items-center gap-4 mt-3 text-gray-400">
                                <span className="inline-flex items-center gap-1 text-xs"><Heart className="w-3.5 h-3.5" />0</span>
                                <span className="inline-flex items-center gap-1 text-xs"><MessageSquare className="w-3.5 h-3.5" />0</span>
                            </div>

                            {/* Descripción */}
                            <div className="mt-4 mb-3">
                                <h3 className="text-xs font-bold text-gray-800 uppercase tracking-wide mb-1.5">Descripción</h3>
                                {description ? (
                                    <p className="text-[13px] text-gray-600 leading-relaxed whitespace-pre-wrap">{description}</p>
                                ) : (
                                    <div className="space-y-1.5">
                                        <div className="h-2.5 rounded-full bg-gray-200 w-full" />
                                        <div className="h-2.5 rounded-full bg-gray-200 w-11/12" />
                                        <div className="h-2.5 rounded-full bg-gray-200 w-4/6" />
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Barra de acciones del candidato (fija abajo) */}
                    <div className="p-3 bg-white border-t border-gray-100 flex-shrink-0 space-y-2">
                        <button className="w-full py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-sm font-bold flex items-center justify-center gap-1.5 shadow-sm">
                            <Send className="w-4 h-4" /> Postularme
                        </button>
                        <div className="grid grid-cols-2 gap-2">
                            <button className="py-2 rounded-xl border border-purple-200 bg-purple-50 text-purple-700 text-xs font-bold flex items-center justify-center gap-1">
                                <PhoneCall className="w-3.5 h-3.5" /> Me llamen
                            </button>
                            <button className="py-2 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-bold flex items-center justify-center gap-1">
                                <MessagesSquare className="w-3.5 h-3.5" /> Escríbeme
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ── Composer de descripción (estilo Facebook): emojis + secciones con color ───
// Secciones rápidas que insertan encabezados con emoji para armar un post atractivo.
// Texto plano (la app lo muestra tal cual con whitespace-pre-wrap) — NADA de markdown
// ni asteriscos, para que se vea igual en el dashboard y en la app del candidato.
const DESC_SECTIONS = [
    { label: '✅ Requisitos', text: '\n\n✅ Requisitos:\n• ', cls: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400' },
    { label: '💰 Ofrecemos', text: '\n\n💰 Ofrecemos:\n• ', cls: 'bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400' },
    { label: '🎯 Funciones', text: '\n\n🎯 Funciones:\n• ', cls: 'bg-violet-50 text-violet-700 hover:bg-violet-100 dark:bg-violet-900/30 dark:text-violet-400' },
    { label: '🕐 Horario', text: '\n\n🕐 Horario:\n', cls: 'bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400' },
    { label: '📍 Zona', text: '\n\n📍 Zona:\n', cls: 'bg-rose-50 text-rose-700 hover:bg-rose-100 dark:bg-rose-900/30 dark:text-rose-400' },
    { label: '📞 Contáctanos', text: '\n\n📞 Contáctanos:\n', cls: 'bg-cyan-50 text-cyan-700 hover:bg-cyan-100 dark:bg-cyan-900/30 dark:text-cyan-400' },
];

function DescriptionComposer({ value, onChange }) {
    const taRef = useRef(null);
    const [showEmojis, setShowEmojis] = useState(false);

    // Inserta texto en la posición del cursor (o al final si no hay foco) y reposiciona el cursor.
    const insert = (text) => {
        const ta = taRef.current;
        const v = value || '';
        if (!ta) { onChange(v + text); return; }
        const s = ta.selectionStart ?? v.length;
        const e = ta.selectionEnd ?? v.length;
        onChange(v.slice(0, s) + text + v.slice(e));
        requestAnimationFrame(() => {
            ta.focus();
            const pos = s + text.length;
            try { ta.setSelectionRange(pos, pos); } catch { /* noop */ }
        });
    };

    useEffect(() => {
        if (!showEmojis) return;
        const onKey = (e) => { if (e.key === 'Escape') setShowEmojis(false); };
        const onClick = (e) => {
            if (!e.target.closest?.('[data-emoji-pop]') && !e.target.closest?.('[data-emoji-btn]')) setShowEmojis(false);
        };
        document.addEventListener('keydown', onKey);
        document.addEventListener('mousedown', onClick);
        return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick); };
    }, [showEmojis]);

    return (
        <div className="flex flex-col h-full min-h-[380px]">
            <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Descripción del puesto</label>
                <span className="text-xs text-gray-400">{(value || '').length} caracteres</span>
            </div>

            {/* Secciones rápidas */}
            <div className="flex flex-wrap gap-1.5 mb-2">
                {DESC_SECTIONS.map(s => (
                    <button key={s.label} type="button" onClick={() => insert(s.text)}
                        className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${s.cls}`}>
                        {s.label}
                    </button>
                ))}
            </div>

            {/* Textarea + emojis */}
            <div className="relative flex-1 flex flex-col">
                <textarea
                    ref={taRef}
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    placeholder={`Escribe aquí tu vacante… dale vida con emojis y secciones 🎉\n\nEj:\n🚀 ¡Únete a nuestro equipo!\nBuscamos gente con muchas ganas de crecer 💪`}
                    className="flex-1 w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white resize-none min-h-[300px] leading-relaxed"
                />
                <button type="button" data-emoji-btn onClick={() => setShowEmojis(v => !v)} title="Emojis"
                    className={`absolute bottom-3 right-3 p-1.5 rounded-lg transition-colors ${showEmojis ? 'text-blue-600 bg-blue-50 dark:bg-blue-900/30' : 'text-gray-400 hover:text-blue-500 hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
                    <Smile className="w-5 h-5" />
                </button>
                {showEmojis && (
                    <div data-emoji-pop className="absolute bottom-12 right-0 z-30 shadow-2xl rounded-2xl overflow-hidden">
                        <Suspense fallback={<div className="w-[300px] h-[380px] bg-white dark:bg-gray-800 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-blue-400" /></div>}>
                            <EmojiPicker onEmojiClick={(ed) => insert(ed.emoji)} {...candidaticEmojiPickerProps()} />
                        </Suspense>
                    </div>
                )}
            </div>

            <p className="text-xs text-gray-400 mt-2 flex items-center gap-1">
                <Sparkles className="w-3 h-3" /> Usa secciones y emojis para un post atractivo, tipo publicación.
            </p>
        </div>
    );
}

// ── Tab Vacantes ─────────────────────────────────────────────────────────────
function TabVacantes({ empresas }) {
    const [jobs, setJobs] = useState(() => bolsaJobsCache || []);
    const [loading, setLoading] = useState(() => !bolsaJobsCache);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [editingJob, setEditingJob] = useState(null);
    const [detailJob, setDetailJob] = useState(null);
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
    const [geoLoading, setGeoLoading] = useState(false);
    const [geoError, setGeoError] = useState('');
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
            if (data.success) { setJobs(data.data || []); bolsaJobsCache = data.data || []; setVisibleCount(PAGE_SIZE); }
        } catch { showToast('Error al cargar vacantes', 'error'); }
        finally { setLoading(false); }
    };

    // Espeja mutaciones locales (crear/editar/borrar) al caché tras la primera carga real.
    useEffect(() => { if (bolsaJobsCache) bolsaJobsCache = jobs; }, [jobs]);

    const handleOpenCreate = () => { setEditingJob(null); setFormData(defaultForm); setGeoError(''); setIsModalOpen(true); };

    // ── Ubicación por liga de Google Maps ──
    const isMapsLink = (s) => /(google\.[a-z.]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps|maps\.google\.)/i.test(String(s || ''));

    const geocodeLocation = async (url) => {
        const link = String(url || '').trim();
        if (!isMapsLink(link)) return;
        setGeoError(''); setGeoLoading(true);
        try {
            const res = await fetch(`/api/bolsa-geocode?url=${encodeURIComponent(link)}`);
            const data = await res.json();
            if (data.success && data.address) {
                setFormData(p => ({ ...p, location: data.address }));
                showToast('Dirección obtenida de la liga', 'success');
            } else {
                setGeoError(data.error || 'No se pudo obtener la dirección');
            }
        } catch {
            setGeoError('Error de conexión al obtener la dirección');
        } finally {
            setGeoLoading(false);
        }
    };

    const handleLocationPaste = (e) => {
        const text = (e.clipboardData?.getData('text') || '').trim();
        if (isMapsLink(text)) {
            e.preventDefault();
            setFormData(p => ({ ...p, location: text }));
            geocodeLocation(text);
        }
    };

    // ── Sueldo por semana: $ automático, solo números y coma ──
    const salaryDigits = (formData.salary || '').replace(/[^\d,]/g, '');
    const handleSalaryChange = (e) => {
        const d = e.target.value.replace(/[^\d,]/g, '');
        setFormData(p => ({ ...p, salary: d ? `$${d} /sem` : '' }));
    };

    const handleEdit = (job) => {
        setEditingJob(job);
        setFormData({
            empresaId: '', title: job.title || '', company: job.company || '',
            location: job.location || '', salary: job.salary || '',
            type: job.type || 'Tiempo Completo', recruiterPhone: job.recruiterPhone || '',
            description: job.description || '', mediaUrl: job.mediaUrl || '',
            companyLogo: job.companyLogo || '',
        });
        setGeoError('');
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

            {/* ── Modal Crear/Editar (horizontal: formulario + preview en vivo) ── */}
            <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editingJob ? 'Editar Vacante' : 'Nueva Vacante'} maxWidth="max-w-6xl">
                <div className="flex flex-col xl:flex-row gap-6">
                    {/* ── Columna 1: datos de la vacante ── */}
                    <div className="xl:w-[320px] flex-shrink-0 space-y-4">
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
                        {/* Ubicación — acepta liga de Google Maps y trae la dirección sola */}
                        <div className="space-y-1">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Ubicación</label>
                            <div className="relative">
                                <input
                                    value={formData.location}
                                    onChange={e => setFormData(p => ({ ...p, location: e.target.value }))}
                                    onPaste={handleLocationPaste}
                                    placeholder="Ciudad, o pega una liga de Google Maps"
                                    className="w-full px-3 py-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                />
                                {geoLoading ? (
                                    <Loader2 className="w-4 h-4 animate-spin text-blue-500 absolute right-3 top-1/2 -translate-y-1/2" />
                                ) : isMapsLink(formData.location) ? (
                                    <button
                                        type="button"
                                        onClick={() => geocodeLocation(formData.location)}
                                        title="Traer dirección de la liga"
                                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 transition-colors"
                                    >
                                        <MapPin className="w-4 h-4" />
                                    </button>
                                ) : null}
                            </div>
                            {geoError
                                ? <p className="text-xs text-red-500">{geoError}</p>
                                : <p className="text-xs text-gray-400">Pega una liga de Google Maps y traemos la dirección sola.</p>}
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            {/* Sueldo por semana: $ automático, solo números y coma */}
                            <div className="space-y-1">
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Sueldo por semana</label>
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400 font-semibold pointer-events-none">$</span>
                                    <input
                                        value={salaryDigits}
                                        onChange={handleSalaryChange}
                                        inputMode="numeric"
                                        placeholder="1,500"
                                        className="w-full pl-6 pr-11 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                    />
                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">/ sem</span>
                                </div>
                            </div>
                            <div className="space-y-1">
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Tipo</label>
                                <select className="w-full pl-2.5 pr-7 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white truncate" value={formData.type} onChange={e => setFormData(p => ({ ...p, type: e.target.value }))}>
                                    <option>Tiempo Completo</option>
                                    <option>Medio Tiempo</option>
                                    <option>Remoto</option>
                                    <option>Híbrido</option>
                                </select>
                            </div>
                        </div>
                        <Input label="WhatsApp Reclutador *" value={formData.recruiterPhone} onChange={e => setFormData(p => ({ ...p, recruiterPhone: e.target.value }))} placeholder="Ej. 8112345678" />
                        <div className="pt-2 border-t border-gray-100 dark:border-gray-700 space-y-4">
                            <ImageUploader
                                label="Logo de Empresa"
                                value={formData.companyLogo}
                                onChange={v => setFormData(p => ({ ...p, companyLogo: v }))}
                                hint="JPG o PNG · cuadrado 512×512 px · máx 4 MB"
                            />
                            <ImageUploader
                                label="Imagen de Vacante"
                                value={formData.mediaUrl}
                                onChange={v => setFormData(p => ({ ...p, mediaUrl: v }))}
                                hint="JPG o PNG · horizontal 1200×675 px (16:9) · máx 4 MB"
                            />
                        </div>
                    </div>

                    {/* ── Columna 2: descripción (composer tipo Facebook) ── */}
                    <div className="flex-1 min-w-0 flex flex-col">
                        <DescriptionComposer value={formData.description} onChange={v => setFormData(p => ({ ...p, description: v }))} />
                    </div>

                    {/* ── Columna 3: preview en vivo dentro del celular ── */}
                    <div className="xl:w-[290px] flex-shrink-0">
                        <VacancyPhonePreview formData={formData} />
                    </div>
                </div>

                {/* Footer de ancho completo */}
                <div className="flex justify-end gap-3 pt-4 mt-6 border-t border-gray-100 dark:border-gray-700">
                    <Button variant="outline" onClick={() => setIsModalOpen(false)}>Cancelar</Button>
                    <Button onClick={handleSave} loading={saving}>{saving ? 'Guardando...' : 'Guardar Vacante'}</Button>
                </div>
            </Modal>

            {confirmModalJSX}
        </>
    );
}

// ── Tab Empresas ─────────────────────────────────────────────────────────────
function TabEmpresas({ onEmpresasChange }) {
    const [empresas, setEmpresas] = useState(() => bolsaEmpresasCache || []);
    const [loading, setLoading] = useState(() => !bolsaEmpresasCache);
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
            if (data.success) { setEmpresas(data.data || []); bolsaEmpresasCache = data.data || []; onEmpresasChange(data.data || []); }
        } catch { showToast('Error al cargar empresas', 'error'); }
        finally { setLoading(false); }
    };

    // Espeja mutaciones locales al caché tras la primera carga real.
    useEffect(() => { if (bolsaEmpresasCache) bolsaEmpresasCache = empresas; }, [empresas]);

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
                        hint="JPG o PNG · cuadrado 512×512 px · máx 4 MB"
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
