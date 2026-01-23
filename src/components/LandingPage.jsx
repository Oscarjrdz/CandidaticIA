import React from 'react';
import { ArrowRight, CheckCircle, BarChart, Users, Zap } from 'lucide-react';
import Button from './ui/Button';

const LandingPage = ({ onLoginClick }) => {
    /* SEARCH LOGIC */
    const [searchQuery, setSearchQuery] = React.useState('');
    const [isSearching, setIsSearching] = React.useState(false);
    const [searchResults, setSearchResults] = React.useState(null);

    const handleSearch = async (e) => {
        e.preventDefault();
        if (!searchQuery.trim()) return;

        setIsSearching(true);
        setSearchResults(null);

        try {
            const res = await fetch('/api/public/ai-search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: searchQuery })
            });
            const data = await res.json();
            if (data.success) {
                setSearchResults(data);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setIsSearching(false);
        }
    };

    return (
        <div className="min-h-screen bg-white text-gray-900 font-sans selection:bg-blue-100 selection:text-blue-900">

            {/* Header */}
            <header className="fixed top-0 w-full z-50 bg-white/80 backdrop-blur-md border-b border-gray-100">
                <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-xl">
                            C
                        </div>
                        <span className="text-xl font-bold tracking-tight text-gray-900">Candidatic IA</span>
                    </div>

                    <nav className="hidden md:flex items-center space-x-8 text-sm font-medium text-gray-600">
                        <a href="#features" className="hover:text-blue-600 transition-colors">Características</a>
                        <a href="#about" className="hover:text-blue-600 transition-colors">Nosotros</a>
                        <a href="#pricing" className="hover:text-blue-600 transition-colors">Precios</a>
                    </nav>

                    <Button
                        onClick={onLoginClick}
                        className="rounded-full px-6 bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-200 hover:shadow-blue-300 transition-all transform hover:-translate-y-0.5"
                    >
                        Ingresar
                    </Button>
                </div>
            </header>

            <main className="pt-32 pb-20 px-6">
                <div className="max-w-7xl mx-auto">

                    {/* Hero Section - Gradient Card */}
                    <div className="relative rounded-[2.5rem] overflow-hidden bg-gradient-to-br from-[#E0F2FE] via-[#EBE9FE] to-[#F3E8FF] p-12 md:p-24 text-center">

                        {/* Background Decorative Blurs */}
                        <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
                            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-400/20 rounded-full blur-3xl"></div>
                            <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-400/20 rounded-full blur-3xl"></div>
                        </div>

                        <div className="relative z-10 max-w-4xl mx-auto">
                            <div className="inline-flex items-center space-x-2 bg-white/60 backdrop-blur-sm px-4 py-1.5 rounded-full text-sm font-medium text-blue-800 mb-8 border border-white/50 shadow-sm">
                                <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                                </span>
                                <span>Nueva versión 2.0 disponible</span>
                            </div>

                            <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-gray-900 mb-8 leading-[1.1]">
                                Revoluciona tu <br />
                                <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-purple-600">
                                    Reclutamiento con IA
                                </span>
                            </h1>

                            <p className="text-xl md:text-2xl text-gray-600 mb-12 max-w-2xl mx-auto leading-relaxed">
                                Automatiza entrevistas, filtra candidatos y encuentra el talento perfecto 10x más rápido con nuestra tecnología de Inteligencia Artificial.
                            </p>

                            {/* AI SEARCH BAR */}
                            <div className="max-w-2xl mx-auto mb-12 relative z-20">
                                <form onSubmit={handleSearch} className="relative group">
                                    <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 to-purple-600 rounded-full blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200"></div>
                                    <div className="relative flex items-center bg-white rounded-full shadow-xl p-2 pr-2">
                                        <div className="pl-4 pr-2 text-gray-400">
                                            <Zap className="w-5 h-5 text-purple-500" />
                                        </div>
                                        <input
                                            type="text"
                                            className="flex-1 bg-transparent border-none focus:ring-0 text-gray-800 placeholder-gray-400 text-lg outline-none"
                                            placeholder="Ej. Busco contador con experiencia en Monterrey..."
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                        />
                                        <button
                                            type="submit"
                                            disabled={isSearching}
                                            className="bg-black text-white rounded-full px-6 py-3 font-medium hover:bg-gray-800 transition-colors flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {isSearching ? (
                                                <span className="animate-spin text-xl">⟳</span>
                                            ) : (
                                                <>
                                                    <span>Buscar</span>
                                                    <ArrowRight className="w-4 h-4" />
                                                </>
                                            )}
                                        </button>
                                    </div>
                                </form>

                                {/* SEARCH RESULTS POPUP */}
                                {searchResults && (
                                    <div className="mt-6 bg-white/90 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/50 p-6 text-left animate-in slide-in-from-bottom-4 duration-500">
                                        <div className="flex items-start justify-between">
                                            <div>
                                                <h3 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                                                    <span>🎉</span>
                                                    Encontramos <span className="text-blue-600">{searchResults.matches_count}</span> candidatos
                                                </h3>
                                                <p className="text-gray-600 mt-1">
                                                    Coinciden con tu búsqueda. Regístrate para ver sus perfiles completos y contactarlos.
                                                </p>
                                            </div>
                                            <Button onClick={onLoginClick} size="sm" className="bg-green-600 hover:bg-green-700 text-white">
                                                Ver Perfiles
                                            </Button>
                                        </div>

                                        {/* Anonymous Preview Tags */}
                                        <div className="flex flex-wrap gap-2 mt-4">
                                            {searchResults.preview.map((p, i) => (
                                                <span key={i} className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200">
                                                    {p.role} • {p.location}
                                                </span>
                                            ))}
                                            {searchResults.matches_count > 10 && (
                                                <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-600 border border-blue-100">
                                                    +{searchResults.matches_count - 10} más
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>


                        </div>
                    </div>



                </div>
            </main>

            <footer className="bg-gray-50 border-t border-gray-200 py-12">
                <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center bg-transparent">
                    <div className="flex items-center space-x-2 mb-4 md:mb-0">
                        <div className="w-6 h-6 bg-gray-300 rounded-md flex items-center justify-center text-white text-xs font-bold">
                            C
                        </div>
                        <span className="font-semibold text-gray-700">Candidatic IA</span>
                    </div>
                    <p className="text-gray-500 text-sm">
                        © {new Date().getFullYear()} Candidatic IA. Todos los derechos reservados.
                    </p>
                </div>
            </footer>
        </div>
    );
};

export default LandingPage;
