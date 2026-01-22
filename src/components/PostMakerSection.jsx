import React, { useState } from 'react';
import {
    Layout, Image as ImageIcon, Smile, MapPin,
    MoreHorizontal, Globe, ThumbsUp, MessageCircle, Share2,
    Monitor, Smartphone, Copy, ExternalLink, Hash, X
} from 'lucide-react';
import Button from './ui/Button';
import Card from './ui/Card';

const PostMakerSection = () => {
    const [content, setContent] = useState('');
    const [link, setLink] = useState('');
    const [previewMode, setPreviewMode] = useState('desktop'); // desktop | mobile
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const [media, setMedia] = useState(null); // { type: 'image' | 'video', url: string }
    const fileInputRef = React.useRef(null);

    // ... (user mock remains)

    const handleFileSelect = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const type = file.type.startsWith('video') ? 'video' : 'image';
                setMedia({ type, url: e.target.result });
            };
            reader.readAsDataURL(file);
        }
    };


    // Mock user for preview
    const user = {
        name: 'Oscar Rodriguez',
        avatar: 'bg-gradient-to-br from-blue-500 to-purple-600',
        initials: 'OR'
    };

    const commonEmojis = ['😀', '😍', '🔥', '🚀', '💡', '✅', '✨', '🎉', '💼', '👨‍💻', '🤖', '📈'];

    const insertEmoji = (emoji) => {
        setContent(prev => prev + emoji);
        setShowEmojiPicker(false);
    };

    const handleCopy = () => {
        navigator.clipboard.writeText(content);
        // Toast logic would go here
        alert('Texto copiado al portapapeles');
    };

    const handleGenerateLink = () => {
        if (!link) {
            alert('Por favor agrega un link para generar el botón de compartir.');
            return;
        }
        // Facebook Sharer URL
        // Note: 'quote' param is deprecated but sometimes works for legacy triggers, 
        // primarily it shares the URL.
        const fbUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}&quote=${encodeURIComponent(content)}`;
        window.open(fbUrl, '_blank', 'width=600,height=400');
    };

    return (
        <div className="h-[calc(100vh-2rem)] flex gap-6 overflow-hidden">
            {/* LEFT COLUMN - EDITOR */}
            <div className="flex-1 flex flex-col space-y-4 overflow-y-auto pr-2">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Post Maker</h2>
                        <p className="text-sm text-gray-500">Crea contenido profesional estilo Meta Business Suite</p>
                    </div>
                </div>

                <Card className="flex-1 flex flex-col">
                    <div className="p-4 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50">
                        <h3 className="font-semibold text-gray-700 dark:text-white">Crear Publicación</h3>
                    </div>

                    <div className="p-6 flex-1 space-y-6">
                        {/* User Info Mock */}
                        <div className="flex items-center space-x-3">
                            <div className={`w-10 h-10 rounded-full ${user.avatar} flex items-center justify-center text-white font-bold text-sm shadow-md`}>
                                {user.initials}
                            </div>
                            <div className="flex-1">
                                <p className="font-bold text-gray-900 dark:text-white">{user.name}</p>
                                <div className="flex items-center space-x-2 text-xs text-gray-500 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded w-fit">
                                    <Globe className="w-3 h-3" />
                                    <span>Público</span>
                                </div>
                            </div>
                        </div>

                        {/* Editor Area */}
                        <div className="relative">
                            <textarea
                                className="w-full h-64 p-4 text-lg bg-transparent border-none focus:ring-0 resize-none placeholder-gray-400 dark:text-white"
                                placeholder={`¿Qué estás pensando, ${user.name.split(' ')[0]}?`}
                                value={content}
                                onChange={(e) => setContent(e.target.value)}
                            />

                            {/* Emoji Picker Popover */}
                            {showEmojiPicker && (
                                <div className="absolute bottom-12 left-4 bg-white dark:bg-gray-800 shadow-xl rounded-xl p-3 border border-gray-100 dark:border-gray-700 grid grid-cols-4 gap-2 z-10 animate-in zoom-in-95">
                                    {commonEmojis.map(emoji => (
                                        <button
                                            key={emoji}
                                            onClick={() => insertEmoji(emoji)}
                                            className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-xl"
                                        >
                                            {emoji}
                                        </button>
                                    ))}
                                    <button
                                        onClick={() => setShowEmojiPicker(false)}
                                        className="col-span-4 mt-2 text-xs text-red-500 hover:bg-red-50 rounded"
                                    >
                                        Cerrar
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Link Input */}
                        <div className="space-y-2">
                            <label className="text-xs font-bold uppercase text-gray-500">Enlace / Artículo (Opcional)</label>
                            <div className="flex items-center space-x-2">
                                <Globe className="w-4 h-4 text-gray-400" />
                                <input
                                    type="url"
                                    placeholder="https://..."
                                    className="flex-1 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                    value={link}
                                    onChange={(e) => setLink(e.target.value)}
                                />
                            </div>
                        </div>

                        {/* Add to Post Actions */}
                        <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-3 flex items-center justify-between shadow-sm">
                            <span className="text-sm font-semibold text-gray-700 dark:text-gray-300 pl-2">Agregar a tu publicación</span>
                            <div className="flex space-x-2">
                                <button
                                    title="Foto/Video"
                                    onClick={() => fileInputRef.current?.click()}
                                    className="p-2 hover:bg-green-50 rounded-full text-green-600 smooth-transition"
                                >
                                    <ImageIcon className="w-6 h-6" />
                                </button>
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    className="hidden"
                                    accept="image/*,video/*"
                                    onChange={handleFileSelect}
                                />
                                <button title="Sentimiento/Actividad" onClick={() => setShowEmojiPicker(!showEmojiPicker)} className="p-2 hover:bg-yellow-50 rounded-full text-yellow-500 smooth-transition">
                                    <Smile className="w-6 h-6" />
                                </button>
                                <button title="Estoy aquí" className="p-2 hover:bg-red-50 rounded-full text-red-500 smooth-transition">
                                    <MapPin className="w-6 h-6" />
                                </button>
                                <button title="Más" className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full text-gray-500 smooth-transition">
                                    <MoreHorizontal className="w-6 h-6" />
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="p-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 flex space-x-3 justify-end">
                        <Button variant="outline" onClick={handleCopy} icon={Copy}>Copiar Texto</Button>
                        <Button
                            onClick={handleGenerateLink}
                            icon={Share2}
                            disabled={!link}
                            className={!link ? 'opacity-50 cursor-not-allowed' : ''}
                        >
                            Generar Link de Publicación
                        </Button>
                    </div>
                </Card>
            </div>

            {/* RIGHT COLUMN - PREVIEW */}
            <div className="w-[400px] flex flex-col space-y-4">
                <div className="flex items-center justify-between px-2">
                    <h3 className="font-semibold text-gray-700 dark:text-gray-300">Vista Previa</h3>
                    <div className="flex bg-gray-200 dark:bg-gray-800 rounded-lg p-1">
                        <button
                            onClick={() => setPreviewMode('desktop')}
                            className={`p-1.5 rounded-md smooth-transition ${previewMode === 'desktop' ? 'bg-white dark:bg-gray-700 shadow text-blue-600' : 'text-gray-500'}`}
                        >
                            <Monitor className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => setPreviewMode('mobile')}
                            className={`p-1.5 rounded-md smooth-transition ${previewMode === 'mobile' ? 'bg-white dark:bg-gray-700 shadow text-blue-600' : 'text-gray-500'}`}
                        >
                            <Smartphone className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                <div className={`
                    flex-1 bg-gray-100 dark:bg-black rounded-2xl border-4 border-gray-300 dark:border-gray-800 overflow-hidden flex flex-col items-center py-8 overflow-y-auto
                    ${previewMode === 'mobile' ? 'px-8' : 'px-4'}
                `}>
                    {/* FB POST CARD */}
                    <div className={`bg-white dark:bg-[#242526] rounded-xl shadow-sm w-full max-w-md overflow-hidden ${previewMode === 'mobile' ? 'text-xs' : 'text-sm'}`}>
                        {/* Header */}
                        <div className="p-3 flex items-start space-x-2">
                            <div className={`w-10 h-10 rounded-full ${user.avatar} flex-shrink-0 flex items-center justify-center text-white font-bold text-xs`}>
                                {user.initials}
                            </div>
                            <div className="flex-1">
                                <p className="font-semibold text-[#050505] dark:text-[#E4E6EB] hover:underline cursor-pointer">
                                    {user.name}
                                </p>
                                <div className="flex items-center space-x-1 text-gray-500 dark:text-[#B0B3B8] text-xs">
                                    <span className="hover:underline cursor-pointer">Just now</span>
                                    <span>·</span>
                                    <Globe className="w-3 h-3" />
                                </div>
                            </div>
                            <button className="text-gray-500 dark:text-[#B0B3B8] hover:bg-gray-100 dark:hover:bg-gray-700 p-2 rounded-full">
                                <MoreHorizontal className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Content */}
                        <div className="px-3 pb-3 text-[#050505] dark:text-[#E4E6EB] whitespace-pre-wrap">
                            {content || <span className={`text-gray-400 italic ${media ? 'hidden' : ''}`}>Tu publicación aparecerá aquí...</span>}
                        </div>

                        {/* Media Preview */}
                        {media && (
                            <div className="w-full bg-black">
                                {media.type === 'video' ? (
                                    <video src={media.url} controls className="w-full max-h-96 object-contain" />
                                ) : (
                                    <img src={media.url} alt="Post content" className="w-full max-h-96 object-contain" />
                                )}
                            </div>
                        )}

                        {/* Link Preview (Mock) */}
                        {link && (
                            <div className="bg-gray-100 dark:bg-[#3A3B3C] border-t border-b border-gray-200 dark:border-[#3E4042]">
                                <div className="h-48 bg-gray-200 dark:bg-gray-700 flex items-center justify-center relative overflow-hidden group">
                                    <div className="absolute inset-0 bg-gray-500/10 group-hover:bg-transparent transition-colors"></div>
                                    <Globe className="w-16 h-16 text-gray-400" />
                                </div>
                                <div className="p-3 bg-gray-50 dark:bg-[#242526]">
                                    <p className="text-xs uppercase text-gray-500 dark:text-[#B0B3B8] mb-1">
                                        {new URL(link).hostname.replace('www.', '').toUpperCase()}
                                    </p>
                                    <p className="font-bold text-[#050505] dark:text-[#E4E6EB] truncate">
                                        Título del enlace o artículo
                                    </p>
                                    <p className="text-xs text-gray-500 dark:text-[#B0B3B8] line-clamp-1 mt-1">
                                        Descripción breve del sitio web o contenido que estás compartiendo...
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* Stats / Footer */}
                        <div className="px-3 py-2 flex items-center justify-between text-gray-500 dark:text-[#B0B3B8] text-xs border-b border-gray-200 dark:border-[#3E4042]">
                            <div className="flex items-center space-x-1">
                                <div className="bg-blue-500 rounded-full p-0.5">
                                    <ThumbsUp className="w-2 h-2 text-white fill-current" />
                                </div>
                                <span>1</span>
                            </div>
                            <div className="flex space-x-3">
                                <span>0 comments</span>
                                <span>0 shares</span>
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="px-1 py-1 flex items-center justify-between">
                            <button className="flex-1 flex items-center justify-center space-x-2 py-1.5 hover:bg-gray-100 dark:hover:bg-[#3A3B3C] rounded-lg text-gray-600 dark:text-[#B0B3B8] font-medium smooth-transition">
                                <ThumbsUp className="w-5 h-5" />
                                <span>Like</span>
                            </button>
                            <button className="flex-1 flex items-center justify-center space-x-2 py-1.5 hover:bg-gray-100 dark:hover:bg-[#3A3B3C] rounded-lg text-gray-600 dark:text-[#B0B3B8] font-medium smooth-transition">
                                <MessageCircle className="w-5 h-5" />
                                <span>Comment</span>
                            </button>
                            <button className="flex-1 flex items-center justify-center space-x-2 py-1.5 hover:bg-gray-100 dark:hover:bg-[#3A3B3C] rounded-lg text-gray-600 dark:text-[#B0B3B8] font-medium smooth-transition">
                                <Share2 className="w-5 h-5" />
                                <span>Share</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PostMakerSection;
