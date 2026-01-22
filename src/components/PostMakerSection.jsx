import React, { useState, useRef, useEffect } from 'react';
import {
    Layout, Image as ImageIcon, Smile, MapPin,
    MoreHorizontal, Globe, ThumbsUp, MessageCircle, Share2,
    Monitor, Smartphone, Copy, ExternalLink, Hash, X, Loader2, Link,
    Edit2, Save
} from 'lucide-react';
import Button from './ui/Button';
import Card from './ui/Card';
import { useToast } from '../hooks/useToast';

const PostMakerSection = () => {
    const { showToast } = useToast();
    const [user, setUser] = useState(null);

    // Form State
    const [editingId, setEditingId] = useState(null); // If set, we are updating
    const [title, setTitle] = useState('BUSCAMOS AYUDANTES GENERALES');
    const [content, setContent] = useState('Mándanos un Whatsapp clic aqui');
    const [targetUrl, setTargetUrl] = useState('https://wa.me/5218116038195');

    const [media, setMedia] = useState(null);
    const [uploadedUrl, setUploadedUrl] = useState(null);
    const [isUploading, setIsUploading] = useState(false);

    // Gallery State
    const [posts, setPosts] = useState([]);
    const [isLoadingPosts, setIsLoadingPosts] = useState(false);

    const [previewMode, setPreviewMode] = useState('desktop');
    const fileInputRef = useRef(null);

    // Initial Load
    useEffect(() => {
        const savedUser = localStorage.getItem('candidatic_user_session');
        if (savedUser) {
            const u = JSON.parse(savedUser);
            setUser(u);
            fetchGallery(u.id);
        }
    }, []);

    const fetchGallery = async (userId) => {
        setIsLoadingPosts(true);
        try {
            const res = await fetch(`/api/posts?userId=${userId}`);
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
        setTargetUrl(post.url);
        setUploadedUrl(post.image);
        setMedia({ type: 'image', url: post.image }); // For preview
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleCancelEdit = () => {
        setEditingId(null);
        setTitle('BUSCAMOS AYUDANTES GENERALES');
        setContent('Mándanos un Whatsapp clic aqui');
        setTargetUrl('https://wa.me/5218116038195');
        setMedia(null);
        setUploadedUrl(null);
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

                    // Limit to 1000px width for safety (Vercel Limit is 4.5MB request body)
                    const MAX_WIDTH = 1000;
                    if (width > MAX_WIDTH) {
                        height = Math.round(height * (MAX_WIDTH / width));
                        width = MAX_WIDTH;
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    // Compress to JPEG 0.7 (Good balance, small size)
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
                    resolve(dataUrl);
                };
                img.src = event.target.result;
            };
            reader.readAsDataURL(file);
        });
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

            if (!res.ok) throw new Error(`Server error: ${res.status}`);

            const data = await res.json();
            if (data.success) {
                const finalUrl = data.url.startsWith('http') ? data.url : `${window.location.origin}${data.url}`;
                setUploadedUrl(finalUrl);
                showToast('Foto subida con éxito', 'success');
            } else {
                throw new Error(data.error || 'Error desconocido');
            }
        } catch (error) {
            console.error(error);
            showToast(`Error: ${error.message || 'No se pudo subir'}`, 'error');
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
            if (editingId) {
                // UPDATE
                const res = await fetch('/api/posts', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        id: editingId,
                        title,
                        description: content,
                        image: uploadedUrl,
                        url: targetUrl
                    })
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
                    body: JSON.stringify({
                        userId: user?.id,
                        title,
                        description: content,
                        image: uploadedUrl,
                        url: targetUrl
                    })
                });
                const data = await res.json();

                if (data.success) {
                    showToast('Link Creado. Galería actualizada.', 'success');
                    fetchGallery(user?.id);
                    handleCancelEdit();
                } else {
                    showToast('Error al guardar el link', 'error');
                }
            }
        } catch (e) {
            showToast('Error de conexión', 'error');
        }
    };

    return (
        <div className="h-[calc(100vh-2rem)] flex flex-col gap-6 p-4 overflow-y-auto">

            {/* TOP AREA: EDITOR & PREVIEW */}
            <div className="flex flex-col lg:flex-row gap-8 min-h-[500px]">

                {/* LEFT: EDITOR (Clean White) */}
                <div className="flex-1 bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-xl font-bold text-gray-800">
                            {editingId ? 'Editando Publicación' : 'Nuevo Link Inteligente'}
                        </h2>
                        {editingId && (
                            <button onClick={handleCancelEdit} className="text-xs text-red-500 font-medium hover:underline">
                                Cancelar Edición
                            </button>
                        )}
                    </div>

                    <div className="space-y-5">
                        {/* Destino */}
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-gray-500 uppercase">Redirect (A dónde irán al dar clic)</label>
                            <div className="flex items-center gap-2 bg-gray-50 rounded-lg p-2 border border-gray-200">
                                <Link className="w-4 h-4 text-gray-400" />
                                <input
                                    type="url"
                                    value={targetUrl}
                                    onChange={(e) => setTargetUrl(e.target.value)}
                                    className="w-full bg-transparent border-none text-gray-700 text-sm focus:ring-0"
                                    placeholder="https://tudestino.com/oferta-empleo"
                                />
                            </div>
                        </div>

                        {/* Imagen */}
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-gray-500 uppercase">Foto del Post (Se ajusta a 1200x630)</label>
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

                        {/* Título & Desc */}
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-gray-500 uppercase">Título (Negritas en FB)</label>
                            <input
                                type="text"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                className="w-full bg-gray-50 border border-gray-200 rounded-lg p-3 text-gray-900 font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                                placeholder="Título llamativo..."
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-gray-500 uppercase">Mensaje (Gris en FB)</label>
                            <textarea
                                value={content}
                                onChange={(e) => setContent(e.target.value)}
                                rows={2}
                                className="w-full bg-gray-50 border border-gray-200 rounded-lg p-3 text-gray-600 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all resize-none"
                                placeholder="Descripción..."
                            />
                        </div>

                        <div className="pt-4 border-t border-gray-100 flex justify-end">
                            <Button
                                onClick={handleSavePost}
                                icon={Save}
                                className={`
                                    ${!uploadedUrl ? 'opacity-70' : 'shadow-lg shadow-blue-600/20'} 
                                    bg-blue-600 hover:bg-blue-700 text-white
                                `}
                            >
                                {isUploading ? 'Subiendo Foto...' : (editingId ? 'Guardar Cambios' : 'Crear y Guardar')}
                            </Button>
                        </div>
                    </div>
                </div>

                {/* RIGHT: PREVIEW (Facebook Style) */}
                <div className="w-[450px] shrink-0 flex flex-col items-center justify-center p-4">
                    <div className="w-full flex justify-between items-center mb-3">
                        <span className="text-xs font-bold text-gray-400 uppercase">Vista Previa</span>
                        <div className="flex gap-2 text-gray-400">
                            <Monitor className={`w-4 h-4 cursor-pointer ${previewMode === 'desktop' ? 'text-blue-500' : ''}`} onClick={() => setPreviewMode('desktop')} />
                            <Smartphone className={`w-4 h-4 cursor-pointer ${previewMode === 'mobile' ? 'text-blue-500' : ''}`} onClick={() => setPreviewMode('mobile')} />
                        </div>
                    </div>

                    <div className="bg-[#18191a] border border-[#3e4042] rounded-lg overflow-hidden shadow-2xl w-full max-w-full">
                        <div className="bg-black aspect-[1.91/1] overflow-hidden flex items-center justify-center relative">
                            {media || uploadedUrl ? (
                                <img src={media?.url || uploadedUrl} className="w-full h-full object-cover" />
                            ) : (
                                <div className="text-gray-600 flex flex-col items-center opacty-50"><ImageIcon className="w-8 h-8" /></div>
                            )}
                        </div>
                        <div className="bg-[#242526] p-3 border-t border-[#3e4042]">
                            <p className="text-[#b0b3b8] text-[12px] uppercase mb-0.5 truncate tracking-wide">
                                CANDIDATIC.AI
                            </p>
                            <h3 className="text-[#e4e6eb] font-bold text-[16px] leading-5 mb-1 line-clamp-1">{title}</h3>
                            <p className="text-[#b0b3b8] text-[14px] leading-5 line-clamp-1">{content}</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* BOTTOM: POST GALLERY */}
            <div className="mt-8">
                <h3 className="text-lg font-bold text-gray-800 mb-4 px-1">Mis Publicaciones ({posts.length})</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {posts.map(post => {
                        const shortUrl = `${window.location.origin}/s/${post.id || post.key?.split(':')[1]}`; // Handle legacy/new
                        return (
                            <div key={post.id || Math.random()} className="bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow p-3 flex flex-col gap-3 group">
                                <div className="aspect-video bg-gray-100 rounded-lg overflow-hidden relative">
                                    <img src={post.image} className="w-full h-full object-cover" />
                                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                        <button onClick={() => handleEdit(post)} className="bg-white p-2 rounded-full text-blue-600 hover:scale-110 transition-transform"><Edit2 className="w-4 h-4" /></button>
                                    </div>
                                </div>
                                <div>
                                    <h4 className="font-bold text-gray-800 text-sm truncate">{post.title}</h4>
                                    <p className="text-xs text-gray-500 truncate">{new Date(post.createdAt || Date.now()).toLocaleDateString()}</p>
                                </div>
                                <div className="mt-auto pt-2 border-t border-gray-50 flex gap-2">
                                    <button
                                        onClick={() => {
                                            navigator.clipboard.writeText(shortUrl);
                                            showToast('Link copiado', 'success');
                                        }}
                                        className="flex-1 bg-gray-50 hover:bg-gray-100 text-gray-600 text-xs py-2 rounded-lg font-medium flex items-center justify-center gap-1"
                                    >
                                        <Copy className="w-3 h-3" /> Copiar Link
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
