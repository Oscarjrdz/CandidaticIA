import React, { useState } from 'react';
import { MapPin, Upload, CheckCircle, AlertCircle, Loader } from 'lucide-react';

const ColoniasImportSettings = ({ showToast }) => {
    const [status, setStatus] = useState(null); // null | 'loading' | 'ok' | 'error'
    const [result, setResult] = useState(null);
    const [errorMsg, setErrorMsg] = useState('');

    const handleFile = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setStatus('loading');
        setResult(null);
        setErrorMsg('');

        try {
            // Read file as text — browser will handle BOM automatically for UTF-8
            const text = await file.text();

            const res = await fetch('/api/admin/seed-colonias', {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain; charset=utf-8' },
                body: text,
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || `Error ${res.status}`);

            setResult(data);
            setStatus('ok');
            showToast?.('Directorio de colonias importado correctamente', 'success');
        } catch (err) {
            setErrorMsg(err.message);
            setStatus('error');
            showToast?.('Error al importar colonias: ' + err.message, 'error');
        }

        // Reset file input so user can re-import
        e.target.value = '';
    };

    return (
        <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-sm border border-gray-100 dark:border-gray-700 p-6">
            <div className="flex items-center gap-3 mb-5">
                <div className="w-9 h-9 rounded-xl bg-emerald-500 flex items-center justify-center shadow-md shadow-emerald-500/20">
                    <MapPin className="w-4 h-4 text-white" />
                </div>
                <div>
                    <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-tight">
                        Directorio de Colonias NL
                    </h3>
                    <p className="text-[10px] font-bold tracking-widest uppercase text-emerald-600 dark:text-emerald-400">
                        NORMALIZACIÓN BRENDA
                    </p>
                </div>
            </div>

            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4 leading-relaxed">
                Importa el archivo CSV con la lista oficial de colonias de Nuevo León.
                Brenda usará este directorio para normalizar el nombre de la colonia del candidato.
                Columnas requeridas: <code className="font-mono bg-gray-100 dark:bg-gray-700 px-1 rounded">municipio</code>, <code className="font-mono bg-gray-100 dark:bg-gray-700 px-1 rounded">colonia</code>, <code className="font-mono bg-gray-100 dark:bg-gray-700 px-1 rounded">cp</code>.
            </p>

            <label className="flex items-center gap-3 cursor-pointer group">
                <div className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all border ${
                    status === 'loading'
                        ? 'bg-gray-100 dark:bg-gray-700 text-gray-400 border-gray-200 dark:border-gray-600 cursor-not-allowed'
                        : 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/40'
                }`}>
                    {status === 'loading' ? (
                        <Loader className="w-4 h-4 animate-spin" />
                    ) : (
                        <Upload className="w-4 h-4" />
                    )}
                    {status === 'loading' ? 'Importando…' : 'Seleccionar CSV'}
                </div>
                <input
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    disabled={status === 'loading'}
                    onChange={handleFile}
                />
            </label>

            {status === 'ok' && result && (
                <div className="mt-4 flex items-start gap-2 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
                    <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-emerald-700 dark:text-emerald-300 font-medium">
                        Importado correctamente — {result.municipios} municipios, {result.colonias.toLocaleString()} colonias
                    </p>
                </div>
            )}

            {status === 'error' && (
                <div className="mt-4 flex items-start gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                    <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-red-700 dark:text-red-300 font-medium">{errorMsg}</p>
                </div>
            )}
        </div>
    );
};

export default ColoniasImportSettings;
