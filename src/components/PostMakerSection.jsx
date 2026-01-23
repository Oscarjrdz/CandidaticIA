import React, { useState, useRef, useEffect } from 'react';
import {
    Layout, Image as ImageIcon, Smile, MapPin,
    MoreHorizontal, Globe, ThumbsUp, MessageCircle, Share2,
    Monitor, Smartphone, Copy, ExternalLink, Hash, X, Loader2,
    Edit2, Save, Trash2, Check, MousePointerClick
} from 'lucide-react';
import Button from './ui/Button';
import Card from './ui/Card';
import { useToast } from '../hooks/useToast';

const PostMakerSection = () => {
    const { showToast } = useToast();
    const [user, setUser] = useState(null);

    // Form State
    const [editingId, setEditingId] = useState(null);
    const [title, setTitle] = useState('BUSCAMOS AYUDANTES GENERALES');
    const [content, setContent] = useState('Mándanos un Whatsapp clic aqui');

    // Redirect State
    const [redirectEnabled, setRedirectEnabled] = useState(false);
    const [redirectUrl, setRedirectUrl] = useState('');

    const [media, setMedia] = useState(null);
    const [uploadedUrl, setUploadedUrl] = useState(null);
    const [isUploading, setIsUploading] = useState(false);

    // Gallery State
    const [posts, setPosts] = useState([]);
    const [isLoadingPosts, setIsLoadingPosts] = useState(false);

    const [previewMode, setPreviewMode] = useState('desktop');
    const fileInputRef = useRef(null);

    // Copy Feedback State
    const [copiedId, setCopiedId] = useState(null);

    // Initial Load
    useEffect(() => {
        try {
            const savedUser = localStorage.getItem('candidatic_user_session');
            if (savedUser) {
                const u = JSON.parse(savedUser);
                setUser(u);
                fetchGallery(u.id);
            }
        } catch (e) {
            console.error("Error loading user:", e);
        }
    }, []);

    const fetchGallery = async (userId) => {
        setIsLoadingPosts(true);
        try {
            const res = await fetch(`/ api / posts ? userId = ${userId} `);
            const data = await res.json();
            if (data.posts) setPosts(data.posts);
        } catch (e) {
            console.error(e);
        } finally {
            setIsLoadingPosts(false);
        }
    };

    // Prepare Edit Mode
    const handleEdit = (post) => {
        setEditingId(post.id);
        setTitle(post.title);
        setContent(post.description);
        setUploadedUrl(post.image);
        setRedirectEnabled(post.redirectEnabled || false);
        setRedirectUrl(post.redirectUrl || '');
        setMedia({ type: 'image', url: post.image });
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleCancelEdit = () => {
        setEditingId(null);
        setTitle('BUSCAMOS AYUDANTES GENERALES');
        setContent('Mándanos un Whatsapp clic aqui');
        setRedirectEnabled(false);
        setRedirectUrl('');
        setMedia(null);
        setUploadedUrl(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleCopy = (text, id) => {
        navigator.clipboard.writeText(text);
        setCopiedId(id);
        showToast('Link copiado al portapapeles', 'success');
        setTimeout(() => setCopiedId(null), 2000);
    };

    // Helper: Resize & Compress Image
    const resizeImage = (file) => {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;

                    // Limit to 800px width (Safe for Vercel/Redis)
                    const MAX_WIDTH = 800;
                    if (width > MAX_WIDTH) {
                        height = Math.round(height * (MAX_WIDTH / width));
                        width = MAX_WIDTH;
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    // Compress to JPEG 0.6 (High compression)
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
                    resolve(dataUrl);
                };
                img.src = event.target.result;
            };
            reader.readAsDataURL(file);
        });
    };

    const handleDelete = async (postId, e) => {
        e.stopPropagation(); // Prevent edit mode
        if (!confirm('¿Seguro que quieres eliminar esta publicación?')) return;

        try {
            const res = await fetch('/api/posts', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: postId, userId: user.id })
            });
            if (res.ok) {
                showToast('Publicación eliminada', 'success');
                fetchGallery(user.id);
                if (editingId === postId) handleCancelEdit();
            } else {
                showToast('No se pudo eliminar', 'error');
            }
        } catch (error) {
            showToast('Error de conexión', 'error');
        }
    };

    const handleFileSelect = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Preview local
        const reader = new FileReader();
        reader.onload = (ev) => {
            setMedia({ type: 'image', url: ev.target.result, file });
        };
        reader.readAsDataURL(file);

        setIsUploading(true);
        try {
            console.log('Compressing image...');
            const compressedBase64 = await resizeImage(file);
            console.log('Uploading payload size:', compressedBase64.length);

            const res = await fetch('/api/upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: compressedBase64, type: 'image/jpeg' })
            });

            if (!res.ok) throw new Error(`Server error: ${res.status} `);

            const data = await res.json();
            if (res.ok) {
                const finalUrl = data.url.startsWith('http') ? data.url : `${window.location.origin}${data.url} `;
                setUploadedUrl(finalUrl);
                showToast('Foto optimizada y lista', 'success');
            } else {
                throw new Error(data.error || 'Error desconocido');
            }
        } catch (error) {
            console.error(error);
            showToast(`Error: ${error.message || 'Intenta con una foto más pequeña'} `, 'error');
        } finally {
            setIsUploading(false);
        }
    };

    const handleSavePost = async () => {
        if (isUploading) {
            showToast('Espera a que termine de subir la foto', 'warning');
            return;
        }
        if (!uploadedUrl) {
            showToast('Sube una foto antes de guardar', 'warning');
            return;
        }

        try {
            const payload = {
                title,
                description: content,
                image: uploadedUrl,
                redirectEnabled,
                redirectUrl,
                userId: user?.id
            };

            if (editingId) {
                // UPDATE
                const res = await fetch('/api/posts', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...payload, id: editingId })
                });
                if (res.ok) {
                    showToast('Post actualizado correctamente', 'success');
                    fetchGallery(user.id);
                    handleCancelEdit();
                }
            } else {
                // CREATE
                const res = await fetch('/api/create-link', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();

                if (data.success) {
                    showToast('Post creado con éxito', 'success');
                    fetchGallery(user?.id);
                    // Clear fields
                    setTitle('Nuevo Post');
                    setContent('');
                    setUploadedUrl(null);
                    setMedia(null);
                    setRedirectEnabled(false);
                    setRedirectUrl('');
                    if (fileInputRef.current) fileInputRef.current.value = '';
                } else {
                    showToast('Error al guardar', 'error');
                }
            }
        } catch (e) {
            showToast('Error de conexión', 'error');
        }
    };

    // Helper for Title Case
    const toTitleCase = (str) => {
        if (!str) return '';
        try {
            return str.toLowerCase().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
        } catch (e) { return str; }
    };

    return (
        <div className="h-[calc(100vh-2rem)] flex flex-col gap-6 p-4 overflow-y-auto">

            {/* TOP AREA: EDITOR & PREVIEW */}
            <div className="flex flex-col lg:flex-row gap-8 mb-4">

                {/* LEFT: EDITOR (Clean White) */}
                <div className="flex-1 bg-white rounded-2xl shadow-sm border border-gray-100 p-6 self-start">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-xl font-bold text-gray-800">
                            {editingId ? 'Editando Publicación' : 'Crea un post'}
                        </h2>
                        {editingId && (
                            <button onClick={handleCancelEdit} className="text-xs text-red-500 font-medium hover:underline">
                                Cancelar Edición
                            </button>
                        )}
                    </div>

                    <div className="space-y-5">
                        {/* Inputs */}
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-gray-500 uppercase">Foto del Post</label>
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    className="bg-blue-50 text-blue-600 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-100 transition-colors flex items-center gap-2"
                                >
                                    {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
                                    {isUploading ? 'Optimizando...' : 'Subir Foto'}
                                </button>
                                <span className="text-xs text-gray-400 truncate max-w-[200px]">
                                    {media?.file?.name || (uploadedUrl ? 'Imagen cargada' : 'Sin imagen')}
                                </span>
                                <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileSelect} />
                            </div>
                        </div>

                        <div className="space-y-1">
                            <label className="text-xs font-bold text-gray-500 uppercase">Título (Negritas en FB)</label>
                            <input
                                type="text"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                className="w-full bg-gray-50 border border-gray-200 rounded-lg p-3 text-gray-900 font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-bold placeholder-gray-400"
                                placeholder="Ej: ¡GRAN OPORTUNIDAD LABORAL!"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-gray-500 uppercase">Mensaje (Gris en FB)</label>
                            <textarea
                                value={content}
                                onChange={(e) => setContent(e.target.value)}
                                rows={3}
                                className="w-full bg-gray-50 border border-gray-200 rounded-lg p-3 text-gray-600 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all resize-none"
                                placeholder="Describe el puesto o mensaje principal..."
                            />
                        </div>

                        {/* Redirect Section */}
                        <div className="pt-2 border-t border-gray-100 mt-2">
                            <div className="flex items-center gap-3 mb-3">
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={redirectEnabled}
                                        onChange={(e) => setRedirectEnabled(e.target.checked)}
                                        className="sr-only peer"
                                    />
                                    <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none ring-0 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                                    <span className="ml-2 text-xs font-bold text-gray-500 uppercase">Redirección Automática</span>
                                </label>
                            </div>

                            {redirectEnabled && (
                                <div className="space-y-1 animate-in fade-in slide-in-from-top-1">
                                    <label className="text-xs font-bold text-gray-500 uppercase">URL de Destino</label>
                                    <div className="flex items-center gap-2">
                                        <ExternalLink className="w-4 h-4 text-gray-400" />
                                        <input
                                            type="url"
                                            value={redirectUrl}
                                            onChange={(e) => setRedirectUrl(e.target.value)}
                                            className="flex-1 bg-blue-50/50 border border-blue-100 rounded-lg p-2 text-sm text-blue-800 placeholder-blue-300 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                                            placeholder="https://google.com/forms/..."
                                        />
                                    </div>
                                    <p className="text-[10px] text-gray-400 pt-1">
                                        * Los bots verán la imagen, pero los usuarios irán a esta URL.
                                    </p>
                                </div>
                            )}
                        </div>

                        <div className="pt-4 border-t border-gray-100 flex justify-end">
                            <Button
                                onClick={handleSavePost}
                                icon={Save}
                                className={`
                                    ${!uploadedUrl ? 'opacity-70' : 'shadow-lg shadow-blue-600/20'} 
                                    bg-blue-600 hover:bg-blue-700 text-white w-full sm:w-auto
                                `}
                            >
                                {isUploading ? 'Subiendo Foto...' : (editingId ? 'Guardar Cambios' : 'Crear Post')}
                            </Button>
                        </div>
                    </div>
                </div>

                {/* RIGHT: PREVIEW (Facebook Feed Style) */}
                <div className="w-full lg:w-[420px] shrink-0 flex flex-col items-center">
                    <div className="w-full flex justify-between items-center mb-3 px-1">
                        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Vista Previa (Facebook Feed)</span>
                        <div className="flex gap-2 text-gray-400 bg-white p-1 rounded-lg border border-gray-100 shadow-sm">
                            <Monitor className={`w-4 h-4 cursor-pointer hover:text-blue-500 ${previewMode === 'desktop' ? 'text-blue-500' : ''}`} onClick={() => setPreviewMode('desktop')} />
                            <Smartphone className={`w-4 h-4 cursor-pointer hover:text-blue-500 ${previewMode === 'mobile' ? 'text-blue-500' : ''}`} onClick={() => setPreviewMode('mobile')} />
                        </div>
                    </div>

                    {/* FB CARD */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 w-full overflow-hidden">

                        {/* Header */}
                        <div className="p-3 flex gap-3 items-center">
                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white font-bold text-lg">
                                {user?.name ? user.name.charAt(0).toUpperCase() : 'U'}
                            </div>
                            <div>
                                <h4 className="font-semibold text-gray-900 text-[15px] leading-tight flex items-center gap-1">
                                    {user?.name ? toTitleCase(user.name) : 'Usuario Candidatic'}
                                </h4>
                                <div className="flex items-center gap-1 text-gray-500 text-[13px]">
                                    <span>Justo ahora</span> · <Globe className="w-3 h-3" />
                                </div>
                            </div>
                            <MoreHorizontal className="w-5 h-5 text-gray-500 ml-auto" />
                        </div>

                        {/* Link Card Area */}
                        <div className="bg-[#f0f2f5] border-t border-b border-gray-200/50">
                            {/* Image */}
                            <div className="aspect-[1.91/1] overflow-hidden flex items-center justify-center bg-gray-100 relative">
                                {media || uploadedUrl ? (
                                    <img src={media?.url || uploadedUrl} className="w-full h-full object-cover" />
                                ) : (
                                    <div className="text-gray-400 flex flex-col items-center gap-2">
                                        <ImageIcon className="w-8 h-8 opacity-50" />
                                        <span className="text-xs">Sube una imagen</span>
                                    </div>
                                )}
                            </div>

                            {/* Meta Portion */}
                            <div className="bg-[#f0f2f5] p-3 border-t border-gray-300/50 hover:bg-[#e4e6eb] cursor-pointer transition-colors block">
                                <p className="text-[#65676b] text-[12px] uppercase mb-0.5 truncate tracking-wide">
                                    CANDIDATIC.AI
                                </p>
                                <div className="font-bold text-[#050505] text-[16px] leading-[20px] mb-1 line-clamp-2">
                                    {title || 'Título del Enlace'}
                                </div>
                                <div className="text-[#65676b] text-[14px] leading-[20px] line-clamp-1">
                                    {content || 'Descripción corta del enlace...'}
                                </div>
                            </div>
                        </div>

                        {/* Footer / Reactions */}
                        <div className="px-3 py-2">
                            {/* Stats */}
                            <div className="flex justify-between items-center text-[#65676b] text-[13px] border-b border-gray-200 pb-2 mb-1">
                                <div className="flex items-center gap-1">
                                    <div className="bg-blue-500 rounded-full p-1 flex items-center justify-center w-4 h-4">
                                        <ThumbsUp className="w-2.5 h-2.5 text-white fill-current" />
                                    </div>
                                    <span>12</span>
                                </div>
                                <div className="flex gap-3">
                                    <span>3 comentarios</span>
                                    <span>1 veces compartido</span>
                                </div>
                            </div>

                            {/* Actions */}
                            <div className="flex justify-between px-2 pt-1">
                                <button className="flex-1 flex items-center justify-center gap-2 py-2 hover:bg-gray-100 rounded-lg text-[#65676b] font-semibold text-[14px] transition-colors">
                                    <ThumbsUp className="w-5 h-5" /> Me gusta
                                </button>
                                <button className="flex-1 flex items-center justify-center gap-2 py-2 hover:bg-gray-100 rounded-lg text-[#65676b] font-semibold text-[14px] transition-colors">
                                    <MessageCircle className="w-5 h-5" /> Comentar
                                </button>
                                <button className="flex-1 flex items-center justify-center gap-2 py-2 hover:bg-gray-100 rounded-lg text-[#65676b] font-semibold text-[14px] transition-colors">
                                    <Share2 className="w-5 h-5" /> Compartir
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* BOTTOM: POST GALLERY */}
            <div className="mt-2">
                <h3 className="text-lg font-bold text-gray-800 mb-4 px-1">Mis Publicaciones ({posts.length})</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {posts.map(post => {
                        const shortUrl = `${window.location.origin} /s/${post.id || post.key?.split(':')[1]} `;
                        const isCopied = copiedId === post.id;

                        return (
                            <div key={post.id || Math.random()} className="bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow p-3 flex flex-col gap-3 group">
                                <div className="aspect-video bg-gray-100 rounded-lg overflow-hidden relative">
                                    <img src={post.image} className="w-full h-full object-cover" />
                                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                        <button onClick={() => handleEdit(post)} className="bg-white p-2 rounded-full text-blue-600 hover:scale-110 transition-transform" title="Editar"><Edit2 className="w-4 h-4" /></button>
                                        <button onClick={(e) => handleDelete(post.id, e)} className="bg-white p-2 rounded-full text-red-500 hover:scale-110 transition-transform" title="Eliminar"><Trash2 className="w-4 h-4" /></button>
                                    </div>
                                </div>
                                <div>
                                    <h4 className="font-bold text-gray-800 text-sm truncate">{post.title}</h4>
                                    <div className="flex justify-between items-center mt-1">
                                        <p className="text-xs text-gray-500 truncate">{new Date(post.createdAt || Date.now()).toLocaleDateString()}</p>
                                        <div className="flex items-center gap-1 text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full" title="Total de clics">
                                            <MousePointerClick className="w-3 h-3" />
                                            {post.clicks || 0}
                                        </div>
                                    </div>
                                </div>
                                <div className="mt-auto pt-2 border-t border-gray-50 flex gap-2">
                                    <button
                                        onClick={() => handleCopy(shortUrl, post.id)}
                                        className={`flex-1 text-xs py-2 rounded-lg font-medium flex items-center justify-center gap-1 transition-colors ${isCopied ? 'bg-green-100 text-green-700' : 'bg-gray-50 hover:bg-gray-100 text-gray-600'
                                            }`}
                                    >
                                        {isCopied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                                        {isCopied ? 'Copiado!' : 'Copiar Link'}
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                    {posts.length === 0 && !isLoadingPosts && (
                        <div className="col-span-full py-12 text-center text-gray-400 bg-gray-50/50 rounded-xl border-dashed border-2 border-gray-100">
                            Crea tu primer link inteligente arriba 👆
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default PostMakerSection;
