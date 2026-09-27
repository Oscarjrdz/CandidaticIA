import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    X, FolderArchive, LayoutGrid, List as ListIcon, Download, Trash2, Loader2,
    Upload, FileText, Image as ImageIcon, Music, Video, File as FileIcon,
} from 'lucide-react';
import { useConfirmModal } from '../ui/ConfirmModal';

// Icono + color por tipo de archivo del expediente.
const typeMeta = (type) => {
    switch (type) {
        case 'image': return { Icon: ImageIcon, color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-500/10' };
        case 'audio': return { Icon: Music, color: 'text-violet-500', bg: 'bg-violet-50 dark:bg-violet-500/10' };
        case 'video': return { Icon: Video, color: 'text-rose-500', bg: 'bg-rose-50 dark:bg-rose-500/10' };
        case 'document': return { Icon: FileText, color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-500/10' };
        default: return { Icon: FileIcon, color: 'text-gray-500', bg: 'bg-gray-100 dark:bg-white/5' };
    }
};

const fmtSize = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const fmtDate = (iso) => {
    if (!iso) return '';
    try {
        return new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch { return ''; }
};

export default function ExpedienteSidepanel({ selectedChat, onClose, showToast, refreshToken }) {
    const candidateId = selectedChat?.id;
    const [entries, setEntries] = useState([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [dragging, setDragging] = useState(false);
    const [view, setView] = useState(() => {
        try { return localStorage.getItem('candidatic:expediente_view') || 'grid'; } catch { return 'grid'; }
    });
    const fileInputRef = useRef(null);
    const { showConfirm, confirmModalJSX } = useConfirmModal();

    useEffect(() => {
        try { localStorage.setItem('candidatic:expediente_view', view); } catch { /* ignore */ }
    }, [view]);

    const load = useCallback(async () => {
        if (!candidateId) { setEntries([]); setLoading(false); return; }
        setLoading(true);
        try {
            const res = await fetch(`/api/candidates/expediente?candidateId=${encodeURIComponent(candidateId)}`);
            const data = await res.json();
            setEntries(Array.isArray(data.entries) ? data.entries : []);
        } catch {
            showToast && showToast('No se pudo cargar el expediente', 'error');
        } finally {
            setLoading(false);
        }
    }, [candidateId, showToast]);

    // Recarga al cambiar de candidato o cuando el chat guarda un archivo (refreshToken).
    useEffect(() => { load(); }, [load, refreshToken]);

    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape' && onClose) onClose(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    const handleUploadFiles = useCallback(async (files) => {
        if (!candidateId || !files?.length) return;
        setUploading(true);
        let ok = 0;
        for (const file of files) {
            try {
                const fd = new FormData();
                fd.append('file', file);
                const up = await fetch('/api/media/upload', { method: 'POST', body: fd });
                const upData = await up.json();
                const url = upData.url || upData.mediaUrl;
                if (!url) throw new Error('sin url');
                const mime = file.type || upData.mime || '';
                const type = mime.startsWith('image/') ? 'image'
                    : mime.startsWith('audio/') ? 'audio'
                    : mime.startsWith('video/') ? 'video'
                    : 'document';
                const res = await fetch('/api/candidates/expediente', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        candidateId, source: 'upload', type, mediaUrl: url,
                        filename: file.name || upData.filename || 'archivo', mime,
                    }),
                });
                const data = await res.json();
                if (data.success && data.entry) ok++;
            } catch { /* sigue con el resto */ }
        }
        setUploading(false);
        if (ok > 0) { showToast && showToast(`${ok} archivo${ok !== 1 ? 's' : ''} agregado${ok !== 1 ? 's' : ''} al expediente 📁`, 'success'); load(); }
        else showToast && showToast('No se pudo subir', 'error');
    }, [candidateId, showToast, load]);

    const onDrop = useCallback((e) => {
        e.preventDefault();
        setDragging(false);
        const files = Array.from(e.dataTransfer?.files || []);
        if (files.length) handleUploadFiles(files);
    }, [handleUploadFiles]);

    const handleDownload = useCallback(async (entry) => {
        try {
            const resp = await fetch(entry.url);
            const blob = await resp.blob();
            const objUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = objUrl;
            a.download = entry.filename || 'archivo';
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(objUrl), 2000);
        } catch {
            showToast && showToast('No se pudo descargar', 'error');
        }
    }, [showToast]);

    const handleDelete = useCallback(async (entry) => {
        const ok = await showConfirm({
            title: 'Quitar del expediente',
            message: `¿Quitar "${entry.filename || 'este archivo'}" del expediente de ${selectedChat?.nombre || 'este candidato'}?`,
            confirmText: 'Quitar',
            variant: 'danger',
        });
        if (!ok) return;
        setEntries(prev => prev.filter(e => e.id !== entry.id)); // optimista
        try {
            const res = await fetch(`/api/candidates/expediente?candidateId=${encodeURIComponent(candidateId)}&entryId=${encodeURIComponent(entry.id)}`, { method: 'DELETE' });
            const data = await res.json();
            if (!data.success) { showToast && showToast('No se pudo quitar', 'error'); load(); }
        } catch {
            showToast && showToast('No se pudo quitar', 'error');
            load();
        }
    }, [candidateId, showConfirm, selectedChat, showToast, load]);

    return (
        <div className="absolute md:relative inset-y-0 right-0 z-30 w-full md:w-[340px] border-l border-[#d1d7db] dark:border-[#222e35] bg-white dark:bg-[#111b21] flex flex-col h-full shadow-2xl md:shadow-none">
            {/* Header */}
            <div className="px-4 py-3 bg-[#f0f2f5] dark:bg-[#202c33] border-b border-[#d1d7db] dark:border-[#222e35] flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                    <FolderArchive className="w-5 h-5 text-amber-500 shrink-0" />
                    <div className="min-w-0">
                        <h3 className="font-bold text-sm text-[#111b21] dark:text-[#e9edef] leading-tight">Expediente Digital</h3>
                        {selectedChat?.nombre && (
                            <p className="text-[11px] text-[#667781] dark:text-[#8696a0] truncate">{selectedChat.nombre}</p>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                    {/* Toggle de vista */}
                    <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden mr-1">
                        <button
                            onClick={() => setView('grid')}
                            title="Vista de cuadrícula"
                            className={`p-1.5 transition-colors ${view === 'grid' ? 'bg-amber-500 text-white' : 'bg-white dark:bg-[#202c33] text-gray-400 hover:bg-gray-50 dark:hover:bg-[#2a3942]'}`}
                        >
                            <LayoutGrid className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => setView('list')}
                            title="Vista de lista"
                            className={`p-1.5 border-l border-gray-200 dark:border-gray-700 transition-colors ${view === 'list' ? 'bg-amber-500 text-white' : 'bg-white dark:bg-[#202c33] text-gray-400 hover:bg-gray-50 dark:hover:bg-[#2a3942]'}`}
                        >
                            <ListIcon className="w-4 h-4" />
                        </button>
                    </div>
                    <button onClick={onClose} className="text-[#54656f] hover:text-[#111b21] dark:text-[#aebac1] dark:hover:text-white p-1">
                        <X className="w-5 h-5" />
                    </button>
                </div>
            </div>

            {/* Subir archivo (desde desktop) */}
            <div
                className={`m-3 rounded-xl border-2 border-dashed transition-colors ${dragging ? 'border-amber-500 bg-amber-50 dark:bg-amber-500/10' : 'border-gray-200 dark:border-gray-700'}`}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
            >
                <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="w-full flex items-center justify-center gap-2 py-3 text-xs font-medium text-[#54656f] dark:text-[#aebac1] hover:text-amber-600 dark:hover:text-amber-400 transition-colors disabled:opacity-60"
                >
                    {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    {uploading ? 'Subiendo…' : 'Arrastra o sube un archivo'}
                </button>
                <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => { const files = Array.from(e.target.files || []); if (files.length) handleUploadFiles(files); e.target.value = ''; }}
                />
            </div>

            {/* Lista de archivos */}
            <div className="flex-1 overflow-y-auto px-3 pb-4">
                {loading ? (
                    <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-300" /></div>
                ) : entries.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                        <FolderArchive className="w-12 h-12 text-gray-200 dark:text-gray-700 mb-3" strokeWidth={1.5} />
                        <p className="text-sm font-medium text-[#54656f] dark:text-[#aebac1]">Expediente vacío</p>
                        <p className="text-xs text-[#8696a0] mt-1">Pasa el cursor sobre una foto, PDF o audio del chat y toca el ícono de guardar 📁, o sube un archivo aquí.</p>
                    </div>
                ) : view === 'grid' ? (
                    <div className="grid grid-cols-2 gap-2.5">
                        {entries.map((entry) => {
                            const { Icon, color, bg } = typeMeta(entry.type);
                            return (
                                <div key={entry.id} className="group relative rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-[#202c33] overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                                    <div className={`aspect-square flex items-center justify-center ${bg} overflow-hidden`}>
                                        {entry.type === 'image' ? (
                                            <img src={entry.url} alt={entry.filename} className="w-full h-full object-cover" loading="lazy" />
                                        ) : (
                                            <Icon className={`w-12 h-12 ${color}`} strokeWidth={1.5} />
                                        )}
                                    </div>
                                    <div className="p-2">
                                        <p className="text-[11px] font-medium text-[#111b21] dark:text-[#e9edef] truncate" title={entry.filename}>{entry.filename}</p>
                                        <p className="text-[10px] text-[#8696a0] truncate">{[fmtSize(entry.sizeBytes), fmtDate(entry.savedAt)].filter(Boolean).join(' · ')}</p>
                                        {entry.note && <p className="text-[10px] text-amber-600 dark:text-amber-400 truncate mt-0.5" title={entry.note}>📝 {entry.note}</p>}
                                    </div>
                                    {/* Acciones (hover) */}
                                    <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button onClick={() => handleDownload(entry)} title="Descargar" className="w-7 h-7 rounded-full bg-white/95 dark:bg-black/60 backdrop-blur shadow flex items-center justify-center text-[#54656f] dark:text-[#e9edef] hover:text-amber-600">
                                            <Download className="w-3.5 h-3.5" />
                                        </button>
                                        <button onClick={() => handleDelete(entry)} title="Quitar" className="w-7 h-7 rounded-full bg-white/95 dark:bg-black/60 backdrop-blur shadow flex items-center justify-center text-[#54656f] dark:text-[#e9edef] hover:text-red-500">
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="space-y-1.5">
                        {entries.map((entry) => {
                            const { Icon, color, bg } = typeMeta(entry.type);
                            return (
                                <div key={entry.id} className="group flex items-center gap-3 rounded-lg border border-gray-100 dark:border-gray-800 bg-white dark:bg-[#202c33] p-2 hover:shadow-sm transition-shadow">
                                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 overflow-hidden ${bg}`}>
                                        {entry.type === 'image' ? (
                                            <img src={entry.url} alt={entry.filename} className="w-full h-full object-cover" loading="lazy" />
                                        ) : (
                                            <Icon className={`w-5 h-5 ${color}`} />
                                        )}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-xs font-medium text-[#111b21] dark:text-[#e9edef] truncate" title={entry.filename}>{entry.filename}</p>
                                        <p className="text-[10px] text-[#8696a0] truncate">{[fmtSize(entry.sizeBytes), fmtDate(entry.savedAt)].filter(Boolean).join(' · ')}</p>
                                        {entry.note && <p className="text-[10px] text-amber-600 dark:text-amber-400 truncate">📝 {entry.note}</p>}
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button onClick={() => handleDownload(entry)} title="Descargar" className="p-1.5 rounded-full text-[#54656f] dark:text-[#aebac1] hover:bg-black/5 dark:hover:bg-white/5 hover:text-amber-600">
                                            <Download className="w-4 h-4" />
                                        </button>
                                        <button onClick={() => handleDelete(entry)} title="Quitar" className="p-1.5 rounded-full text-[#54656f] dark:text-[#aebac1] hover:bg-black/5 dark:hover:bg-white/5 hover:text-red-500">
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
            {confirmModalJSX}
        </div>
    );
}
