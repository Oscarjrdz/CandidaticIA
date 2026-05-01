import React, { createContext, useContext, useState, useCallback } from 'react';
import Toast from '../components/ui/Toast';

const ToastContext = createContext(null);

/**
 * Global toast context — eliminates prop drilling of `showToast` across 14+ sections.
 * Usage: const { showToast } = useToastContext();
 */
export const useToastContext = () => {
    const ctx = useContext(ToastContext);
    if (!ctx) throw new Error('useToastContext must be used within ToastProvider');
    return ctx;
};

export const ToastProvider = ({ children }) => {
    const [toast, setToast] = useState(null);

    const showToast = useCallback((message, type = 'info', duration = 5000) => {
        setToast({ message, type, duration });
    }, []);

    const hideToast = useCallback(() => {
        setToast(null);
    }, []);

    return (
        <ToastContext.Provider value={{ showToast, hideToast }}>
            {children}
            {toast && (
                <Toast
                    message={toast.message}
                    type={toast.type}
                    duration={toast.duration}
                    onClose={hideToast}
                />
            )}
        </ToastContext.Provider>
    );
};
