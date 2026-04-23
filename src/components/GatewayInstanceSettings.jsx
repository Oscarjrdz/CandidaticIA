import React, { useState, useEffect, useRef } from 'react';
import { Radio, Copy, Check, Tag, ChevronDown, Save, Loader2, Key, Hash } from 'lucide-react';
import Card from './ui/Card';

const GatewayInstanceSettings = ({ showToast }) => {
    const [copied, setCopied] = useState(false);
    const [tags, setTags] = useState([]);
    const [selectedTag, setSelectedTag] = useState('GATEWAY');
    const [instanceId, setInstanceId] = useState('');
    const [token, setToken] = useState('');
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
        // Load all available tags
        fetch('/api/tags')
            .then(res => res.json())
            .then(data => {
                if (data.success && data.tags) {
                    const migrated = data.tags.map((t, i) => {
                        if (typeof t === 'string') return { name: t, color: ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#a855f7','#ec4899','#8b5cf6','#64748b'][i % 9] };
                        return t;
                    });
                    if (!migrated.find(t => t.name === 'GATEWAY')) {
                        migrated.push({ name: 'GATEWAY', color: '#7c3aed' });
                    }
                    setTags(migrated);
                }
            })
            .catch(() => {});

        // Load saved gateway tag
        fetch('/api/settings?type=gateway_tag')
            .then(res => res.json())
            .then(data => {
                if (data.success && data.data) setSelectedTag(data.data);
            })
            .catch(() => {});

        // Load credentials
        fetch('/api/settings?type=gateway_credentials')
            .then(res => res.json())
            .then(data => {
                if (data.success && data.data) {
                    setInstanceId(data.data.instanceId || '');
                    setToken(data.data.token || '');
                }
            })
            .catch(() => {});
    }, []);

    const handleCopy = () => {
        navigator.clipboard.writeText(`${window.location.origin}/api/gateway/instance`);
        setCopied(true);
        showToast?.('URL del webhook copiada', 'success');
        setTimeout(() => setCopied(false), 2000);
    };

    const handleTagSelect = async (tagName) => {
        if (tagName === selectedTag) { setDropdownOpen(false); return; }
        setSelectedTag(tagName);
        setDropdownOpen(false);
        try {
            await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'gateway_tag', data: tagName })
            });
            showToast?.('Etiqueta Gateway actualizada', 'success');
        } catch { showToast?.('Error al guardar', 'error'); }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const res = await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'gateway_credentials', data: { instanceId, token } })
            });
            const data = await res.json();
            if (data.success) showToast?.('Credenciales Gateway guardadas', 'success');
            else showToast?.('Error al guardar', 'error');
        } catch { showToast?.('Error de red', 'error'); }
        finally { setSaving(false); }
    };

    return (
        <Card title="Gateway Instance" icon={Radio}>
            <div className="space-y-2.5 pb-1">
                {/* Tag selector */}
                <div>
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400 flex items-center gap-1">
                            <Tag className="w-2.5 h-2.5" /> Etiqueta:
                        </span>
                    </div>
                    <div ref={dropdownRef} className="relative z-50">
                        <button
                            onClick={() => setDropdownOpen(!dropdownOpen)}
                            className="w-full flex items-center justify-between bg-[#f0f2f5] dark:bg-[#202c33] border rounded px-2 py-1.5 text-xs text-[#111b21] dark:text-[#e9edef] outline-none font-medium hover:border-gray-400 transition-colors"
                            style={{ borderColor: (tags.find(t => t.name === selectedTag))?.color || '#7c3aed', borderWidth: '1.5px' }}
                        >
                            <span className="truncate">{selectedTag}</span>
                            <ChevronDown className="w-3 h-3 opacity-70 flex-shrink-0" />
                        </button>
                        {dropdownOpen && (
                            <div className="absolute bottom-full left-0 mb-1 w-full bg-white dark:bg-[#111b21] border border-gray-200 dark:border-[#222e35] rounded-md shadow-xl max-h-40 overflow-y-auto z-[60]">
                                {tags.map((tag, idx) => (
                                    <button key={idx} onClick={() => handleTagSelect(tag.name)}
                                        className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-[#202c33] flex items-center ${selectedTag === tag.name ? 'bg-violet-50 dark:bg-violet-900/20 font-bold' : 'text-gray-700 dark:text-gray-300'}`}>
                                        <span className="w-2 h-2 rounded-full mr-2 flex-shrink-0" style={{ backgroundColor: tag.color }}></span>
                                        <span className="truncate">{tag.name}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Instance ID + Token */}
                <div className="grid grid-cols-2 gap-2">
                    <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-0.5">Instance ID</label>
                        <div className="relative">
                            <Hash className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                            <input
                                type="text"
                                placeholder="b3f9..."
                                className="w-full pl-7 pr-2 py-1.5 bg-[#f0f2f5] dark:bg-[#202c33] border border-gray-200 dark:border-gray-700 rounded text-xs outline-none focus:border-violet-500 dark:text-gray-100 transition-colors font-mono"
                                value={instanceId}
                                onChange={(e) => setInstanceId(e.target.value)}
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 ml-0.5">Token</label>
                        <div className="relative">
                            <Key className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                            <input
                                type="password"
                                placeholder="abc1..."
                                className="w-full pl-7 pr-2 py-1.5 bg-[#f0f2f5] dark:bg-[#202c33] border border-gray-200 dark:border-gray-700 rounded text-xs outline-none focus:border-violet-500 dark:text-gray-100 transition-colors font-mono"
                                value={token}
                                onChange={(e) => setToken(e.target.value)}
                            />
                        </div>
                    </div>
                </div>
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="w-full py-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
                >
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    <span>Guardar</span>
                </button>

                {/* Webhook URL */}
                <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400">Webhook URL:</span>
                        <button onClick={handleCopy}
                            className="text-[9px] text-violet-600 hover:text-violet-700 dark:text-violet-400 font-bold flex items-center gap-0.5 bg-violet-50 dark:bg-violet-900/20 px-1.5 py-0.5 rounded transition-colors">
                            {copied ? <Check className="w-2.5 h-2.5" /> : <Copy className="w-2.5 h-2.5" />}
                            <span>{copied ? 'Copiado' : 'Copiar'}</span>
                        </button>
                    </div>
                    <code className="block w-full p-1.5 bg-gray-50 dark:bg-gray-900/80 rounded border border-gray-200 dark:border-gray-700 text-[9px] font-mono whitespace-nowrap overflow-x-auto text-gray-700 dark:text-gray-300 shadow-inner">
                        {typeof window !== 'undefined' ? window.location.origin : 'https://candidatic-ia.vercel.app'}/api/gateway/instance
                    </code>
                </div>
            </div>
        </Card>
    );
};

export default GatewayInstanceSettings;
