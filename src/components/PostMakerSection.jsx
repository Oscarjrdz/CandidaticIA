import React, { useState, useRef } from 'react';
import {
    Layout, Image as ImageIcon, Smile, MapPin,
    MoreHorizontal, Globe, ThumbsUp, MessageCircle, Share2,
    Monitor, Smartphone, Copy, ExternalLink, Hash, X, Loader2, Link
} from 'lucide-react';
import Button from './ui/Button';
import Card from './ui/Card';
import { useToast } from '../hooks/useToast';

const PostMakerSection = () => {
    const { showToast } = useToast();
    const [title, setTitle] = useState('BUSCAMOS AYUDANTES GENERALES');
    const [content, setContent] = useState('Mándanos un Whatsapp clic aqui');
    const [targetUrl, setTargetUrl] = useState('https://wa.me/5218116038195');

    const [media, setMedia] = useState(null); // { type, url, file }
    const [uploadedUrl, setUploadedUrl] = useState(null);
    const [isUploading, setIsUploading] = useState(false);
    const [generatedLink, setGeneratedLink] = useState('');

    const [previewMode, setPreviewMode] = useState('desktop');
    const fileInputRef = useRef(null);

    // Compress and Upload Image
    const handleFileSelect = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Preview immediately
        const reader = new FileReader();
        reader.onload = (ev) => {
            setMedia({ type: 'image', url: ev.target.result, file });
        };
        reader.readAsDataURL(file);

        // Upload Process
        setIsUploading(true);
        try {
            // Compress logic would look like: 
            // 1. Draw to canvas
            // 2. Convert to base64 (jpeg, 0.8 quality)
            // For now, sending raw base64 (assuming reasonable size or Vercel limitation will hit)

            // Re-read file as base64 for upload
            const base64Data = await new Promise((resolve) => {
                const r = new FileReader();
                r.onload = () => resolve(r.result);
                r.readAsDataURL(file);
            });

            const res = await fetch('/api/upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: base64Data, type: file.type })
            });

            const data = await res.json();
            if (data.success) {
                // Ensure we use absolute URL if 'url' is relative
                const finalUrl = data.url.startsWith('http') ? data.url : `${window.location.origin}${data.url}`;
                setUploadedUrl(finalUrl);
                showToast('Foto subida al repositorio automático', 'success');
            } else {
                showToast('Error subiendo foto', 'error');
            }
        } catch (error) {
            console.error(error);
            showToast('Error de conexión', 'error');
        } finally {
            setIsUploading(false);
        }
    };

    const handleGenerateLink = () => {
        if (!uploadedUrl) {
            showToast('Espera a que se suba la imagen', 'warning');
            return;
        }

        const baseUrl = window.location.origin;
        const shareApi = `${baseUrl}/api/share`;

        const params = new URLSearchParams({
            title: title,
            description: content,
            image: uploadedUrl,
            url: targetUrl
        });

        const finalLink = `${shareApi}?${params.toString()}`;
        setGeneratedLink(finalLink);

        // Open Facebook Sharer
        const fbUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(finalLink)}`;
        window.open(fbUrl, '_blank', 'width=600,height=400');
    };

    const handleCopyLink = () => {
        if (!generatedLink) return;
        navigator.clipboard.writeText(generatedLink);
        showToast('Link copiado al portapapeles', 'success');
    };

    return (
        <div className="h-[calc(100vh-2rem)] flex gap-8 overflow-hidden p-4">

            {/* LEFT COLUMN - EDITOR (DARK CARD STYLE) */}
            <div className="flex-1 flex flex-col justify-center max-w-2xl mx-auto w-full">

                <div className="bg-[#1e1e1e] rounded-xl shadow-2xl overflow-hidden border border-gray-700/50">
                    {/* Header */}
                    <div className="px-6 py-4 border-b border-gray-700 flex justify-between items-center bg-[#252525]">
                        <h2 className="text-white font-medium text-sm">
                            Crear etiquetas para el dominio <span className="text-yellow-400">candidatic.ai</span>
                        </h2>
                        <div className="flex gap-2">
                            <div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/50"></div>
                            <div className="w-3 h-3 rounded-full bg-yellow-500/20 border border-yellow-500/50"></div>
                            <div className="w-3 h-3 rounded-full bg-green-500/20 border border-green-500/50"></div>
                        </div>
                    </div>

                    <div className="p-8 space-y-6">

                        {/* URL INPUT */}
                        <div className="space-y-2">
                            <label className="text-[11px] font-bold text-yellow-500 uppercase tracking-wider">
                                Link de Destino (donde irán al dar clic)
                            </label>
                            <div className="flex items-center gap-2 bg-[#2a2a2a] rounded p-1 border border-gray-700 focus-within:border-yellow-500/50 transition-colors">
                                <Link className="w-4 h-4 text-gray-400 ml-2" />
                                <input
                                    type="url"
                                    value={targetUrl}
                                    onChange={(e) => setTargetUrl(e.target.value)}
                                    className="w-full bg-transparent border-none text-gray-300 text-sm focus:ring-0 placeholder-gray-600"
                                    placeholder="https://..."
                                />
                            </div>
                        </div>

                        {/* PHOTO INPUT */}
                        <div className="space-y-2">
                            <label className="text-[11px] font-bold text-yellow-500 uppercase tracking-wider">
                                Foto (Automáticamente Hosteada)
                            </label>
                            <div className="flex items-center gap-4">
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    className="bg-white text-black px-4 py-2 rounded text-sm font-bold hover:bg-gray-200 transition-colors flex items-center gap-2"
                                >
                                    {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Seleccionar archivo'}
                                </button>
                                <span className="text-gray-400 text-sm">
                                    {media ? media.file.name : 'Sin archivos seleccionados'}
                                </span>
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    className="hidden"
                                    accept="image/*"
                                    onChange={handleFileSelect}
                                />
                            </div>
                            {uploadedUrl && (
                                <p className="text-[10px] text-green-400 flex items-center gap-1">
                                    <Globe className="w-3 h-3" /> Foto pública lista para Facebook
                                </p>
                            )}
                        </div>

                        {/* TITLE INPUT */}
                        <div className="space-y-2">
                            <label className="text-[11px] font-bold text-yellow-500 uppercase tracking-wider">
                                Título (Máximo 35 Caracteres)
                            </label>
                            <input
                                type="text"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                maxLength={60}
                                className="w-full bg-[#333333] border-none rounded p-3 text-white text-sm focus:ring-1 focus:ring-yellow-500/50 placeholder-gray-500 font-bold tracking-wide"
                                placeholder="Escribe un título llamativo..."
                            />
                        </div>

                        {/* DESCRIPTION INPUT */}
                        <div className="space-y-2">
                            <label className="text-[11px] font-bold text-yellow-500 uppercase tracking-wider">
                                Mensaje (Descripción)
                            </label>
                            <textarea
                                value={content}
                                onChange={(e) => setContent(e.target.value)}
                                maxLength={150}
                                rows={3}
                                className="w-full bg-[#333333] border-none rounded p-3 text-gray-300 text-sm focus:ring-1 focus:ring-yellow-500/50 placeholder-gray-600 resize-none"
                                placeholder="Escribe una descripción breve..."
                            />
                        </div>

                        {/* ACTIONS */}
                        <div className="pt-4 border-t border-gray-700 flex justify-end gap-3">
                            {generatedLink && (
                                <Button variant="secondary" onClick={handleCopyLink} icon={Copy} className="text-xs">
                                    Copiar Link Generado
                                </Button>
                            )}
                            <Button
                                onClick={handleGenerateLink}
                                disabled={!uploadedUrl || isUploading}
                                className={`${!uploadedUrl ? 'opacity-50 cursor-not-allowed' : ''} bg-yellow-500 hover:bg-yellow-400 text-black border-none font-bold`}
                                icon={Share2}
                            >
                                {isUploading ? 'Subiendo Foto...' : 'Generar Link'}
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            {/* RIGHT COLUMN - PREVIEW (OPEN GRAPH CARD) */}
            <div className="w-[500px] flex flex-col justify-center">
                <div className="mb-4 flex justify-between items-center text-gray-400 px-2">
                    <span className="text-xs font-bold uppercase tracking-widest">Vista Previa (Facebook)</span>
                    <div className="flex bg-gray-800 rounded p-1">
                        <button onClick={() => setPreviewMode('desktop')} className={`p-1.5 rounded ${previewMode === 'desktop' ? 'bg-gray-600 text-white' : 'text-gray-500'}`}><Monitor className="w-4 h-4" /></button>
                        <button onClick={() => setPreviewMode('mobile')} className={`p-1.5 rounded ${previewMode === 'mobile' ? 'bg-gray-600 text-white' : 'text-gray-500'}`}><Smartphone className="w-4 h-4" /></button>
                    </div>
                </div>

                {/* THE CARD */}
                <div className="bg-[#18191a] border border-[#3e4042] rounded-lg overflow-hidden shadow-xl max-w-full">
                    {/* Image Area */}
                    <div className="app-image-preview bg-black aspect-[1.91/1] flex items-center justify-center overflow-hidden relative group">
                        {media ? (
                            <img src={media.url} alt="Preview" className="w-full h-full object-cover" />
                        ) : (
                            <div className="text-gray-600 flex flex-col items-center">
                                <ImageIcon className="w-12 h-12 mb-2 opacity-50" />
                                <span className="text-xs uppercase font-bold tracking-widest">1200 x 630</span>
                            </div>
                        )}
                        {/* Overlay to simulate click */}
                        <div className="absolute inset-0 bg-transparent hover:bg-white/5 transition-colors cursor-pointer"></div>
                    </div>

                    {/* Metadata Area */}
                    <div className="bg-[#242526] p-3 border-t border-[#3e4042]">
                        <p className="text-[#b0b3b8] text-[12px] uppercase mb-0.5 truncate tracking-wide">
                            {new URL(targetUrl).hostname.toUpperCase()}
                        </p>
                        <h3 className="text-[#e4e6eb] font-bold text-[16px] leading-5 mb-1 line-clamp-1">
                            {title || 'Título del Enlace'}
                        </h3>
                        <p className="text-[#b0b3b8] text-[14px] leading-5 line-clamp-1">
                            {content || 'Descripción del enlace...'}
                        </p>
                    </div>
                </div>

                <p className="mt-4 text-center text-xs text-gray-500 max-w-sm mx-auto">
                    * Así es como Facebook mostrará tu enlace cuando lo compartas. La imagen se alojará automáticamente en tu sistema.
                </p>
            </div>
        </div>
    );
};

export default PostMakerSection;
