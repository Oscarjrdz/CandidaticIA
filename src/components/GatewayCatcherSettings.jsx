import React, { useState, useEffect, useRef } from 'react';
import { Database, Copy, Check, Tag, ChevronDown } from 'lucide-react';
import Card from './ui/Card';

const GatewayCatcherSettings = ({ showToast }) => {
    const [copied, setCopied] = useState(false);
    const [tags, setTags] = useState([]);
    const [selectedTag, setSelectedTag] = useState('CATCHER');
    const [saving, setSaving] = useState(false);
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const dropdownRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
                setDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        fetch('/api/tags')
            .then(res => res.json())
            .then(data => {
                if (data.success && data.tags) {
                    const migrated = data.tags.map((t, i) => {
                        if (typeof t === 'string') return { name: t, color: ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#a855f7','#ec4899','#8b5cf6','#64748b'][i % 9] };
                        return t;
                    });
                    // Ensure CATCHER tag is visually present in options just in case
                    if (!migrated.find(t => t.name === 'CATCHER')) {
                        migrated.push({ name: 'CATCHER', color: '#8b5cf6' });
                    }
                    setTags(migrated);
                }
            })
            .catch(() => {});
            
        fetch('/api/settings?type=catcher_tag')
            .then(res => res.json())
            .then(data => {
                if (data.success && data.data) setSelectedTag(data.data);
            })
            .catch(() => {});
    }, []);

    const handleCopy = () => {
        navigator.clipboard.writeText(`${window.location.origin}/api/gateway/catcher`);
        setCopied(true);
        showToast?.('URL del webhook de Catcher copiada', 'success');
        setTimeout(() => setCopied(false), 2000);
    };

    const handleTagSelect = async (tagName) => {
        if (tagName === selectedTag) {
            setDropdownOpen(false);
            return;
        }
        
        setSelectedTag(tagName);
        setDropdownOpen(false);
        setSaving(true);
        
        try {
            const res = await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'catcher_tag', data: tagName })
            });
            const data = await res.json();
            if (data.success) {
                showToast?.('Etiqueta base de Catcher actualizada', 'success');
            } else {
                showToast?.('Error al guardar etiqueta', 'error');
            }
        } catch(err) {
            showToast?.('Error de red al intentar guardar', 'error');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card
            title="Webhook catcher"
            icon={Database}
        >
            <div className="space-y-3 pb-1">
                {/* Asignacion de Etiqueta */}
                <div ref={dropdownRef} className="relative z-50">
                    <span className="text-[11px] font-bold text-gray-700 dark:text-gray-300 flex items-center justify-between mb-1">
                        <span className="flex items-center gap-1.5"><Tag className="w-3 h-3" /> Etiqueta predeterminada:</span>
                        {saving && <span className="text-[9px] text-gray-500 animate-pulse font-normal">Guardando...</span>}
                    </span>
                    
                    <button
                        onClick={() => !saving && setDropdownOpen(!dropdownOpen)}
                        disabled={saving}
                        className="w-full flex items-center justify-between bg-[#f0f2f5] dark:bg-[#202c33] border rounded px-2 py-1.5 text-xs text-[#111b21] dark:text-[#e9edef] outline-none font-medium shadow-sm hover:border-gray-400 disabled:opacity-50 transition-colors"
                        style={{
                            borderColor: (tags.find(t => t.name === selectedTag))?.color || '#8b5cf6',
                            borderWidth: '1.5px'
                        }}
                    >
                        <span>{selectedTag}</span>
                        <ChevronDown className="w-3.5 h-3.5 opacity-70" />
                    </button>

                    {dropdownOpen && (
                        <div className="absolute top-full left-0 mt-1 w-full bg-white dark:bg-[#111b21] border border-gray-200 dark:border-[#222e35] rounded-md shadow-xl max-h-48 overflow-y-auto z-[60]">
                            {tags.map((tag, idx) => (
                                <button
                                    key={idx}
                                    onClick={() => handleTagSelect(tag.name)}
                                    className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-[#202c33] flex items-center ${selectedTag === tag.name ? 'bg-blue-50 dark:bg-blue-900/20 font-bold' : 'text-gray-700 dark:text-gray-300'}`}
                                >
                                    <span 
                                        className="w-2.5 h-2.5 rounded-full mr-2" 
                                        style={{ backgroundColor: tag.color }}
                                    ></span>
                                    {tag.name}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
                
                {/* Webhook URL */}
                <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">Webhook URL:</span>
                        <button
                            onClick={handleCopy}
                            className="text-[10px] text-purple-600 hover:text-purple-700 dark:text-purple-400 font-bold flex items-center space-x-1 transition-colors bg-purple-50 dark:bg-purple-900/20 px-2 py-0.5 rounded"
                        >
                            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                            <span>{copied ? 'Copiado' : 'Copiar'}</span>
                        </button>
                    </div>
                    <code className="block w-full p-1.5 bg-gray-50 dark:bg-gray-900/80 rounded border border-gray-200 dark:border-gray-700 text-[10px] font-mono whitespace-nowrap overflow-x-auto text-gray-700 dark:text-gray-300 shadow-inner">
                        {typeof window !== 'undefined' ? window.location.origin : 'https://candidatic-ia.vercel.app'}/api/gateway/catcher
                    </code>
                </div>
            </div>
        </Card>
    );
};

export default GatewayCatcherSettings;
