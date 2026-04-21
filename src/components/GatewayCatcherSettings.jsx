import React, { useState } from 'react';
import { Database, Link, Copy, Check, ShieldAlert, FishSymbol } from 'lucide-react';
import Card from './ui/Card';

const GatewayCatcherSettings = ({ showToast }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        navigator.clipboard.writeText(`${window.location.origin}/api/gateway/catcher`);
        setCopied(true);
        showToast?.('URL del webhook de Catcher copiada', 'success');
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <Card
            title="Webhook catcher"
            icon={Database}
        >
            <div className="space-y-4">
                {/* Webhook URL */}
                <div className="pt-2">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                            Webhook URL Catcher:
                        </span>
                        <button
                            onClick={handleCopy}
                            className="text-[10px] text-purple-600 hover:text-purple-700 dark:text-purple-400 dark:hover:text-purple-300 font-bold flex items-center space-x-1 transition-colors"
                        >
                            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                            <span>{copied ? 'Copiado' : 'Copiar URL'}</span>
                        </button>
                    </div>
                    <code className="block w-full p-2.5 bg-gray-50 dark:bg-gray-900/80 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-mono break-all text-gray-700 dark:text-gray-300 shadow-inner">
                        {typeof window !== 'undefined' ? window.location.origin : 'https://candidatic-ia.vercel.app'}/api/gateway/catcher
                    </code>
                </div>
            </div>
        </Card>
    );
};

export default GatewayCatcherSettings;
