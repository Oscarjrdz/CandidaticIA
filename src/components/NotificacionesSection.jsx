import React, { useState, useEffect } from 'react';
import { Bell, Send, Users, Briefcase, BarChart2, Loader2, CheckCircle, XCircle, Clock } from 'lucide-react';

const TARGET_OPTIONS = [
  { value: 'all',        label: 'Todos',         desc: 'Candidatos y reclutadores',  color: '#6366f1' },
  { value: 'candidates', label: 'Candidatos',     desc: 'Solo app de candidatos',     color: '#ea580c' },
  { value: 'recruiters', label: 'Reclutadores',   desc: 'Solo app de reclutadores',   color: '#2563eb' },
];

function _fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function NotificacionesSection() {
  const [stats, setStats] = useState({ candidates: 0, recruiters: 0, total: 0 });
  const [_history, _setHistory] = useState([]);
  const [loadingStats, setLoadingStats] = useState(true);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [target, setTarget] = useState('all');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => { loadStats(); }, []);

  const loadStats = async () => {
    try {
      const res = await fetch('/api/notificaciones');
      const data = await res.json();
      if (data.success) {
        setStats(data.stats);
        // Obtener historial desde el endpoint (en el futuro)
      }
    } catch {}
    finally { setLoadingStats(false); }
  };

  const handleSend = async () => {
    if (!title.trim() || !body.trim()) return;
    setSending(true);
    setResult(null);
    try {
      const res = await fetch('/api/notificaciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), body: body.trim(), target }),
      });
      const data = await res.json();
      if (data.success) {
        setResult({ ok: true, sent: data.sent, total: data.total });
        setTitle('');
        setBody('');
        loadStats();
      } else {
        setResult({ ok: false, error: data.error || 'Error al enviar' });
      }
    } catch {
      setResult({ ok: false, error: 'Error de conexión' });
    } finally {
      setSending(false);
    }
  };

  const selectedTarget = TARGET_OPTIONS.find(t => t.value === target);
  const targetCount = target === 'all' ? stats.total : target === 'candidates' ? stats.candidates : stats.recruiters;
  const canSend = title.trim() && body.trim() && targetCount > 0 && !sending;

  return (
    <div className="space-y-4 w-full pb-8">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-3xl shadow-lg p-6 flex flex-col md:flex-row items-center justify-between gap-4 text-white">
        <div className="flex items-center space-x-4">
          <div className="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
            <Bell className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold uppercase tracking-tight">Notificaciones Push</h2>
            <p className="text-indigo-100 text-sm mt-1">Envía mensajes directos a la app de candidatos y reclutadores.</p>
          </div>
        </div>
        {/* Stats rápidos */}
        {loadingStats ? (
          <Loader2 className="w-6 h-6 animate-spin text-white/60" />
        ) : (
          <div className="flex gap-3">
            <div className="bg-white/15 rounded-2xl px-4 py-2 text-center">
              <p className="text-2xl font-black">{stats.candidates}</p>
              <p className="text-xs text-indigo-200 mt-0.5">Candidatos</p>
            </div>
            <div className="bg-white/15 rounded-2xl px-4 py-2 text-center">
              <p className="text-2xl font-black">{stats.recruiters}</p>
              <p className="text-xs text-indigo-200 mt-0.5">Reclutadores</p>
            </div>
            <div className="bg-white/15 rounded-2xl px-4 py-2 text-center">
              <p className="text-2xl font-black">{stats.total}</p>
              <p className="text-xs text-indigo-200 mt-0.5">Total</p>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ── Panel de envío ── */}
        <div className="bg-white dark:bg-gray-800 rounded-3xl border border-gray-100 dark:border-gray-700 p-6 space-y-5">
          <h3 className="font-bold text-gray-900 dark:text-white text-base flex items-center gap-2">
            <Send className="w-4 h-4 text-indigo-500" /> Redactar notificación
          </h3>

          {/* Target selector */}
          <div>
            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest block mb-2">Destinatarios</label>
            <div className="flex gap-2">
              {TARGET_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setTarget(opt.value)}
                  className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all border ${target === opt.value ? 'text-white border-transparent' : 'text-gray-500 bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600 hover:bg-gray-100'}`}
                  style={target === opt.value ? { backgroundColor: opt.color, borderColor: opt.color } : {}}
                >
                  <div>{opt.label}</div>
                  <div className="text-[9px] mt-0.5 opacity-80">
                    {opt.value === 'all' ? stats.total : opt.value === 'candidates' ? stats.candidates : stats.recruiters} activos
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Título */}
          <div>
            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest block mb-1.5">Título</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              maxLength={80}
              placeholder="Ej. ¡Nueva vacante disponible!"
              className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            />
            <p className="text-right text-[10px] text-gray-400 mt-1">{title.length}/80</p>
          </div>

          {/* Mensaje */}
          <div>
            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest block mb-1.5">Mensaje</label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              maxLength={200}
              rows={3}
              placeholder="Ej. Hay una nueva vacante de Ventas en Monterrey que podría interesarte. ¡Entra y postúlate!"
              className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none resize-none"
            />
            <p className="text-right text-[10px] text-gray-400 mt-1">{body.length}/200</p>
          </div>

          {/* Preview */}
          {(title || body) && (
            <div className="rounded-2xl p-4 bg-gray-50 dark:bg-gray-700 border border-gray-100 dark:border-gray-600">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Vista previa</p>
              <div className="rounded-xl p-3 bg-gray-900 flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center" style={{ backgroundColor: selectedTarget?.color }}>
                  <Bell className="w-4 h-4 text-white" />
                </div>
                <div>
                  <p className="text-xs font-bold text-white leading-tight">{title || 'Título'}</p>
                  <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{body || 'Mensaje...'}</p>
                </div>
              </div>
            </div>
          )}

          {/* Resultado */}
          {result && (
            <div className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium ${result.ok ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'}`}>
              {result.ok ? <CheckCircle className="w-5 h-5 flex-shrink-0" /> : <XCircle className="w-5 h-5 flex-shrink-0" />}
              {result.ok
                ? `✓ Enviada a ${result.sent} de ${result.total} dispositivo${result.total !== 1 ? 's'  : ''}`
                : result.error}
            </div>
          )}

          {/* Botón enviar */}
          <button
            onClick={handleSend}
            disabled={!canSend}
            className="w-full py-3.5 rounded-2xl text-sm font-bold text-white flex items-center justify-center gap-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ backgroundColor: canSend ? selectedTarget?.color : '#94a3b8' }}
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {sending
              ? 'Enviando...'
              : targetCount === 0
              ? 'Sin dispositivos activos'
              : `Enviar a ${targetCount} dispositivo${targetCount !== 1 ? 's' : ''}`}
          </button>
        </div>

        {/* ── Info lateral ── */}
        <div className="space-y-4">
          {/* Cómo funciona */}
          <div className="bg-white dark:bg-gray-800 rounded-3xl border border-gray-100 dark:border-gray-700 p-6">
            <h3 className="font-bold text-gray-900 dark:text-white text-base flex items-center gap-2 mb-4">
              <BarChart2 className="w-4 h-4 text-indigo-500" /> Dispositivos activos
            </h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 bg-orange-50 dark:bg-orange-900/20 rounded-2xl">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-orange-100 dark:bg-orange-900/40 rounded-lg flex items-center justify-center">
                    <Users className="w-4 h-4 text-orange-500" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-900 dark:text-white">Candidatos</p>
                    <p className="text-xs text-gray-400">App candidato</p>
                  </div>
                </div>
                <span className="text-2xl font-black text-orange-500">{stats.candidates}</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-blue-50 dark:bg-blue-900/20 rounded-2xl">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/40 rounded-lg flex items-center justify-center">
                    <Briefcase className="w-4 h-4 text-blue-500" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-900 dark:text-white">Reclutadores</p>
                    <p className="text-xs text-gray-400">App reclutador</p>
                  </div>
                </div>
                <span className="text-2xl font-black text-blue-500">{stats.recruiters}</span>
              </div>
            </div>

            <div className="mt-4 p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-2xl">
              <p className="text-xs text-indigo-600 dark:text-indigo-400 font-medium">
                💡 Los dispositivos se registran automáticamente cuando un usuario abre la app por primera vez después de aceptar las notificaciones.
              </p>
            </div>
          </div>

          {/* Próximas funciones */}
          <div className="bg-white dark:bg-gray-800 rounded-3xl border border-gray-100 dark:border-gray-700 p-6">
            <h3 className="font-bold text-gray-900 dark:text-white text-base flex items-center gap-2 mb-3">
              <Clock className="w-4 h-4 text-gray-400" /> Próximamente
            </h3>
            <ul className="space-y-2">
              {[
                'Notificación automática al publicar nueva vacante',
                'Notificación al reclutador cuando llega un candidato',
                'Segmentación por categoría o municipio',
                'Programar notificaciones',
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-gray-500 dark:text-gray-400">
                  <span className="mt-0.5 text-gray-300">○</span> {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
