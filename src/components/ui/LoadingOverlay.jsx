import React from 'react';

const LoadingOverlay = ({ message = 'Cargando...' }) => {
    return (
        <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-white/70 dark:bg-gray-900/80 backdrop-blur-xl animate-in fade-in duration-500">
            {/* Cargador de puntos flotantes — movimiento circular */}
            <div className="dots-loader">
                <div></div>
                <div></div>
                <div></div>
                <div></div>
            </div>

            <div className="mt-6 text-center">
                <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400">
                    {message}
                </h2>
            </div>
        </div>
    );
};

export default LoadingOverlay;
