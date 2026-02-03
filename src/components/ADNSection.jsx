import React, { useState, useEffect } from 'react';
import {
    Zap, Shield, Database, User, Settings,
    ChevronRight, Eye, RefreshCw, Lock, Sparkles
} from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';
import { formatValue } from '../utils/formatters';

const ADNSection = ({ showToast }) => {
    const [loading, setLoading] = useState(false);
    const [candidates, setCandidates] = useState([]);
    const [selectedCand, setSelectedCand] = useState(null);
    const [customPrompt, setCustomPrompt] = useState('');
    const [isRefreshing, setIsRefreshing] = useState(false);

    const CORE_RULES = `
Eres el asistente virtual de Candidatic, un experto en reclutamiento amigable y profesional.
Tu objetivo es ayudar a los candidatos a responder sus dudas sobre vacantes, estatus de postulación o información general.

[FILTRO DE SEGURIDAD - PASO 1]:
Tu prioridad número 1 es asegurar que el perfil del candidato esté COMPLETO. 
- Si el [ESTATUS PASO 1] es "INCOMPLETO": Tu única misión es obtener los datos faltantes.
- Si el [ESTATUS PASO 1] es "COMPLETO": Puedes proceder con el flujo normal.

[PROTOCOLO DE SEGUIMIENTO PROACTIVO]:
Si un candidato con perfil INCOMPLETO deja de responder:
1. Nivel 1 (24h): Recordatorio amable de la Lic. Brenda.
2. Nivel 2 (48h): Re-confirmación de interés profesional.
3. Nivel 3 (72h): Recordatorio de Oportunidad (Motivación).

REGLAS DE TRÁFICO: Máximo 1 mensaje por minuto y 100 por día (7:00 AM - 11:00 PM).
REGLA DE BLOQUEO DE PROYECTOS: Prohibido hablar de "Proyectos" o "Silos Estratégicos".
`;

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        setLoading(true);
        try {
            const [candsRes, settingsRes] = await Promise.all([
                fetch('/api/candidates'),
                fetch('/api/bot-ia/settings')
            ]);

            if (candsRes.ok) {
                const data = await candsRes.json();
                setCandidates(data.slice(0, 5)); // Just take first 5 for demo
                if (data.length > 0) setSelectedCand(data[0]);
            }

            if (settingsRes.ok) {
                const sData = await settingsRes.json();
                setCustomPrompt(sData.systemPrompt || '');
            }
        } catch (error) {
            console.error('Error fetching ADN data:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleRefresh = () => {
        setIsRefreshing(true);
        setTimeout(() => {
            fetchData();
            setIsRefreshing(false);
            if (showToast) showToast('Arquitectura sincronizada', 'success');
        }, 1000);
    };

    const Layer = ({ number, title, icon: Icon, color, description, content, isLocked }) => (
        <div className="relative group animate-in slide-in-from-bottom duration-500" style={{ animationDelay: `${number * 100}ms` }}>
            <div className={`absolute -left-3 top-0 bottom-0 w-1 rounded-full bg-gradient-to-b ${color} opacity-50 group-hover:opacity-100 transition-opacity`} />
            <div className="bg-white dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/50 rounded-2xl p-6 shadow-sm hover:shadow-md transition-all backdrop-blur-sm">
                <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-4">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center bg-gradient-to-br ${color} text-white shadow-lg`}>
                            <Icon className="w-5 h-5" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Nivel {number}</span>
                                {isLocked && <Lock className="w-3 h-3 text-slate-400" />}
                            </div>
                            <h3 className="text-lg font-bold text-slate-800 dark:text-white">{title}</h3>
                        </div>
                    </div>
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">{description}</p>
                <div className="bg-slate-50 dark:bg-slate-900/50 rounded-xl p-4 border border-slate-100 dark:border-slate-800/50 overflow-hidden">
                    <pre className="text-[11px] font-mono text-slate-600 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
                        {content || 'Cargando datos dinámicos...'}
                    </pre>
                </div>
            </div>
        </div>
    );

    return (
        <div className="max-w-5xl mx-auto space-y-8 pb-12">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-black text-slate-900 dark:text-white uppercase tracking-tighter flex items-center gap-3">
                        <Sparkles className="w-8 h-8 text-blue-500" />
                        Arquitectura del Cerebro IA
                    </h1>
                    <p className="text-slate-500 dark:text-slate-400 font-medium">Visualiza cómo piensa y procesa el bot en tiempo real.</p>
                </div>
                <Button
                    variant="outline"
                    icon={RefreshCw}
                    onClick={handleRefresh}
                    disabled={isRefreshing}
                    className={isRefreshing ? 'animate-spin' : ''}
                >
                    Sincronizar Lógica
                </Button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Left: Layers */}
                <div className="lg:col-span-2 space-y-6">
                    <Layer
                        number={1}
                        title="Directivas de Seguridad"
                        icon={Shield}
                        color="from-blue-600 to-blue-400"
                        description="Reglas inamovibles que garantizan el correcto funcionamiento del sistema."
                        content={CORE_RULES}
                        isLocked
                    />

                    <Layer
                        number={2}
                        title="ADN del Candidato (Contexto)"
                        icon={User}
                        color="from-purple-600 to-purple-400"
                        description="Información que el bot inyecta dinámicamente según quién le escribe."
                        content={selectedCand ? `
- Nombre: ${selectedCand.nombreReal || selectedCand.nombre}
- WhatsApp: ${selectedCand.whatsapp}
- Municipio: ${formatValue(selectedCand.municipio)}
- Escolaridad: ${formatValue(selectedCand.escolaridad)}
- Estatus Paso 1: ${selectedCand.nombreReal && formatValue(selectedCand.municipio) !== '-' ? 'COMPLETO' : 'INCOMPLETO'}
                        `.trim() : 'Selecciona un candidato para ver su ADN'}
                    />

                    <Layer
                        number={3}
                        title="Base de Conocimiento Activa"
                        icon={Database}
                        color="from-emerald-600 to-emerald-400"
                        description="Datos de vacantes y archivos que el bot consulta para responder."
                        content="[CONECTADO A BASE DE DATOS DE VACANTES]
Extrayendo información relevante de las vacantes activas y categorías..."
                    />

                    <Layer
                        number={4}
                        title="Personalización del Usuario"
                        icon={Settings}
                        color="from-orange-600 to-orange-400"
                        description="Tus instrucciones específicas configuradas en la sección Bot IA."
                        content={customPrompt || 'Sin instrucciones adicionales del administrador.'}
                    />
                </div>

                {/* Right: Preview Tools */}
                <div className="space-y-6">
                    <Card title="Selector de Candidato" icon={Eye}>
                        <p className="text-[11px] text-slate-500 mb-4">Simula la respuesta del bot para diferentes perfiles.</p>
                        <div className="space-y-2">
                            {candidates.map(cand => (
                                <button
                                    key={cand.id}
                                    onClick={() => setSelectedCand(cand)}
                                    className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all ${selectedCand?.id === cand.id
                                        ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
                                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-blue-300'
                                        }`}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-500">
                                            {cand.nombre?.charAt(0)}
                                        </div>
                                        <div className="text-left">
                                            <div className="text-xs font-black text-slate-800 dark:text-white truncate max-w-[120px]">
                                                {cand.nombreReal || cand.nombre}
                                            </div>
                                            <div className="text-[10px] text-slate-400">{cand.whatsapp}</div>
                                        </div>
                                    </div>
                                    {selectedCand?.id === cand.id && <ChevronRight className="w-4 h-4 text-blue-500" />}
                                </button>
                            ))}
                        </div>
                    </Card>

                    <div className="p-6 rounded-[32px] bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-xl shadow-blue-500/20 relative overflow-hidden group">
                        <div className="absolute -right-4 -top-4 w-24 h-24 bg-white/10 rounded-full blur-2xl group-hover:scale-150 transition-transform duration-700" />
                        <h4 className="font-black uppercase tracking-tighter mb-2 relative z-10">Estado del ADN</h4>
                        <div className="flex items-center gap-2 mb-4 relative z-10">
                            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                            <span className="text-[10px] font-bold uppercase tracking-widest text-blue-100">Sincronizado</span>
                        </div>
                        <p className="text-xs text-blue-50/80 leading-relaxed relative z-10">
                            El bot reconstruye estas instrucciones en cada mensaje recibido para garantizar respuestas siempre actualizadas.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ADNSection;
