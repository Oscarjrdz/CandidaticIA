import React from 'react';

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true };
    }

    componentDidCatch(error, errorInfo) {
        console.error("ErrorBoundary caught an error:", error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return this.props.fallback || (
                <div className="p-10 bg-red-600 text-white rounded-2xl text-center shadow-2xl animate-in zoom-in-95 duration-300">
                    <h3 className="text-xl font-black mb-4 uppercase tracking-widest text-white">⚠️ Error Crítico de Renderizado</h3>
                    <p className="text-sm opacity-90 mb-6 max-w-xs mx-auto">
                        JavaScript colapsó en este componente específico. Esto suele ser por datos inválidos o una falla en el motor de React.
                    </p>
                    <button
                        onClick={() => this.setState({ hasError: false })}
                        className="px-8 py-3 bg-white text-red-600 rounded-full text-xs font-black hover:bg-red-50 transition-all uppercase shadow-lg hover:scale-105 active:scale-95"
                    >
                        Forzar Reintento
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
