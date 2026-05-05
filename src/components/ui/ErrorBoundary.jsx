import React from 'react';

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        console.error("ErrorBoundary caught an error:", error, errorInfo);
        this.setState({ errorInfo });
    }

    /** Detect if the error is a stale chunk / dynamic import failure */
    isChunkError() {
        const msg = this.state.error?.message || '';
        return (
            msg.includes('Failed to fetch dynamically imported module') ||
            msg.includes('Loading chunk') ||
            msg.includes('Loading CSS chunk') ||
            msg.includes('ChunkLoadError')
        );
    }

    handleReload() {
        // Clear all chunk-reload flags so the retry wrapper starts clean
        try {
            Object.keys(sessionStorage).forEach((key) => {
                if (key.startsWith('chunk_reload_')) sessionStorage.removeItem(key);
            });
        } catch (_) { /* noop */ }
        window.location.reload();
    }

    render() {
        if (this.state.hasError) {
            const errorMsg = this.state.error?.message || 'Error desconocido';
            const errorStack = this.state.error?.stack || '';
            const componentStack = this.state.errorInfo?.componentStack || '';
            const isChunk = this.isChunkError();

            return this.props.fallback || (
                <div className="p-10 bg-red-600 text-white rounded-2xl text-center shadow-2xl animate-in zoom-in-95 duration-300">
                    <h3 className="text-xl font-black mb-4 uppercase tracking-widest text-white">
                        {isChunk ? '🔄 Actualización Disponible' : '⚠️ Error Crítico de Renderizado'}
                    </h3>
                    <p className="text-sm opacity-90 mb-2 max-w-lg mx-auto">
                        {isChunk
                            ? 'Se publicó una nueva versión de Candidatic. Recarga la página para cargar los archivos actualizados.'
                            : 'JavaScript colapsó en este componente específico.'}
                    </p>
                    
                    {/* Show actual error for debugging */}
                    {!isChunk && (
                        <div className="bg-red-900/50 rounded-lg p-3 mb-4 max-w-2xl mx-auto text-left overflow-auto max-h-48">
                            <p className="text-xs font-mono text-red-200 font-bold mb-1">💥 {errorMsg}</p>
                            {errorStack && (
                                <pre className="text-[10px] font-mono text-red-300/70 whitespace-pre-wrap break-words mt-1 max-h-20 overflow-auto">
                                    {errorStack.split('\n').slice(1, 6).join('\n')}
                                </pre>
                            )}
                            {componentStack && (
                                <pre className="text-[10px] font-mono text-yellow-300/70 whitespace-pre-wrap break-words mt-1 border-t border-red-700 pt-1 max-h-20 overflow-auto">
                                    {componentStack.split('\n').slice(0, 5).join('\n')}
                                </pre>
                            )}
                        </div>
                    )}

                    <div className="flex gap-3 justify-center">
                        {!isChunk && (
                            <button
                                onClick={() => {
                                    const text = `Error: ${errorMsg}\nStack: ${errorStack}\nComponent: ${componentStack}`;
                                    navigator.clipboard.writeText(text).catch(() => {});
                                }}
                                className="px-6 py-3 bg-red-800 text-white rounded-full text-xs font-bold hover:bg-red-700 transition-all uppercase shadow-lg"
                            >
                                📋 Copiar Error
                            </button>
                        )}
                        {isChunk ? (
                            <button
                                onClick={() => this.handleReload()}
                                className="px-8 py-3 bg-white text-red-600 rounded-full text-xs font-black hover:bg-red-50 transition-all uppercase shadow-lg hover:scale-105 active:scale-95"
                            >
                                🔄 Recargar Página
                            </button>
                        ) : (
                            <button
                                onClick={() => this.setState({ hasError: false, error: null, errorInfo: null })}
                                className="px-8 py-3 bg-white text-red-600 rounded-full text-xs font-black hover:bg-red-50 transition-all uppercase shadow-lg hover:scale-105 active:scale-95"
                            >
                                Forzar Reintento
                            </button>
                        )}
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;

