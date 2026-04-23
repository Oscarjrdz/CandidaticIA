import React, { useState, useCallback } from 'react';

/**
 * 🎨 Candidatic ConfirmModal — Universal Confirmation Dialog
 * 
 * Replaces ALL native window.confirm() dialogs across the app.
 * Provides consistent branding, animations, and dark mode support.
 * 
 * Usage (functional, Promise-based):
 *   const [confirmModal, setConfirmModal] = useState(null);
 * 
 *   // In your handler:
 *   const confirmed = await new Promise(resolve => setConfirmModal({
 *       title: 'Eliminar',
 *       message: '¿Estás seguro?',
 *       confirmText: 'Eliminar',
 *       variant: 'danger',
 *       onConfirm: () => resolve(true),
 *       onCancel: () => resolve(false)
 *   }));
 *   if (!confirmed) return;
 * 
 *   // In your JSX:
 *   <ConfirmModal config={confirmModal} onClose={() => setConfirmModal(null)} />
 */

const VARIANTS = {
    danger: {
        gradient: 'bg-gradient-to-r from-red-500 via-rose-500 to-pink-500',
        iconBg: 'bg-red-50 dark:bg-red-900/20',
        iconColor: 'text-red-500',
        btnBg: 'bg-red-500 hover:bg-red-600 shadow-lg shadow-red-500/25',
        icon: (
            <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
            </svg>
        )
    },
    warning: {
        gradient: 'bg-gradient-to-r from-amber-400 via-orange-500 to-red-400',
        iconBg: 'bg-amber-50 dark:bg-amber-900/20',
        iconColor: 'text-amber-500',
        btnBg: 'bg-amber-500 hover:bg-amber-600 shadow-lg shadow-amber-500/25',
        icon: (
            <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
        )
    },
    success: {
        gradient: 'bg-gradient-to-r from-emerald-400 via-green-500 to-teal-500',
        iconBg: 'bg-emerald-50 dark:bg-emerald-900/20',
        iconColor: 'text-emerald-500',
        btnBg: 'bg-emerald-500 hover:bg-emerald-600 shadow-lg shadow-emerald-500/25',
        icon: (
            <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
        )
    },
    info: {
        gradient: 'bg-gradient-to-r from-blue-400 via-indigo-500 to-purple-500',
        iconBg: 'bg-blue-50 dark:bg-blue-900/20',
        iconColor: 'text-blue-500',
        btnBg: 'bg-blue-500 hover:bg-blue-600 shadow-lg shadow-blue-500/25',
        icon: (
            <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
            </svg>
        )
    }
};

const ConfirmModal = ({ config, onClose }) => {
    if (!config) return null;

    const variant = VARIANTS[config.variant] || VARIANTS.info;

    const handleConfirm = () => {
        config.onConfirm?.();
        onClose();
    };

    const handleCancel = () => {
        config.onCancel?.();
        onClose();
    };

    return (
        <>
            <div
                className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
                onClick={(e) => { if (e.target === e.currentTarget) handleCancel(); }}
            >
                {/* Backdrop */}
                <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" style={{ animation: 'confirmFadeIn 0.2s ease-out' }} />

                {/* Modal Card */}
                <div
                    className="relative w-full max-w-[400px] rounded-2xl overflow-hidden shadow-2xl"
                    style={{ animation: 'confirmSlideUp 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)' }}
                >
                    {/* Gradient Top Bar */}
                    <div className={`h-1.5 w-full ${variant.gradient}`} />

                    <div className="bg-white dark:bg-[#1f2c34] p-6">
                        {/* Icon */}
                        <div className="flex justify-center mb-4">
                            <div className={`w-14 h-14 rounded-full flex items-center justify-center ${variant.iconBg}`}>
                                <span className={variant.iconColor}>{variant.icon}</span>
                            </div>
                        </div>

                        {/* Title */}
                        <h3 className="text-lg font-semibold text-center text-[#111b21] dark:text-[#e9edef] mb-2">
                            {config.title}
                        </h3>

                        {/* Message */}
                        <p className="text-sm text-center text-[#54656f] dark:text-[#8696a0] mb-6 leading-relaxed">
                            {config.message}
                        </p>

                        {/* Buttons */}
                        <div className="flex gap-3">
                            <button
                                onClick={handleCancel}
                                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium text-[#54656f] dark:text-[#aebac1] bg-[#f0f2f5] dark:bg-[#202c33] hover:bg-[#e2e5e9] dark:hover:bg-[#2a3942] transition-all duration-200 active:scale-[0.97]"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleConfirm}
                                className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-medium text-white transition-all duration-200 active:scale-[0.97] ${variant.btnBg}`}
                            >
                                {config.confirmText || 'Aceptar'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Animations (only rendered once, browser deduplicates) */}
            <style>{`
                @keyframes confirmFadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes confirmSlideUp {
                    from { opacity: 0; transform: scale(0.9) translateY(20px); }
                    to { opacity: 1; transform: scale(1) translateY(0); }
                }
            `}</style>
        </>
    );
};

/**
 * Hook for easy usage:
 *   const { confirmModal, confirmModalJSX, showConfirm } = useConfirmModal();
 * 
 *   // In handler:
 *   const ok = await showConfirm({ title: '...', message: '...', variant: 'danger', confirmText: 'Eliminar' });
 *   if (!ok) return;
 * 
 *   // In JSX:
 *   {confirmModalJSX}
 */
export const useConfirmModal = () => {
    const [config, setConfig] = useState(null);

    const showConfirm = useCallback(({ title, message, confirmText, variant = 'danger' }) => {
        return new Promise(resolve => {
            setConfig({
                title,
                message,
                confirmText,
                variant,
                onConfirm: () => resolve(true),
                onCancel: () => resolve(false)
            });
        });
    }, []);

    const confirmModalJSX = <ConfirmModal config={config} onClose={() => setConfig(null)} />;

    return { confirmModal: config, confirmModalJSX, showConfirm };
};

export default ConfirmModal;
