import React from 'react';
import Toast from '../components/ui/Toast';

/**
 * Hook para manejar toasts
 */
export const useToast = () => {
    const [toast, setToast] = React.useState(null);

    const showToast = (message, type = 'info', duration = 5000) => {
        setToast({ message, type, duration });
    };

    const hideToast = () => {
        setToast(null);
    };

    return {
        toast,
        showToast,
        hideToast,
        ToastComponent: toast ? (
            <Toast
                message={toast.message}
                type={toast.type}
                duration={toast.duration}
                onClose={hideToast}
            />
        ) : null,
    };
};
