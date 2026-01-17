import React, { useState, useEffect } from 'react';
import { Settings, Moon, Sun, Download, Upload, Trash2 } from 'lucide-react';
import { useToast } from './components/ui/Toast';
import Button from './components/ui/Button';
import CredentialsSection from './components/CredentialsSection';
import ConnectionStatus from './components/ConnectionStatus';
import WebhookConfig from './components/WebhookConfig';
import EventMonitor from './components/EventMonitor';
import QuickTest from './components/QuickTest';
import { getTheme, saveTheme, exportConfig, importConfig, clearAllStorage } from './utils/storage';

function App() {
  const [botId, setBotId] = useState('');
  const [answerId, setAnswerId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [theme, setTheme] = useState('light');
  const { toast, showToast, hideToast, ToastComponent } = useToast();

  // Cargar tema al iniciar
  useEffect(() => {
    const savedTheme = getTheme();
    setTheme(savedTheme);
    if (savedTheme === 'dark') {
      document.documentElement.classList.add('dark');
    }
  }, []);

  // Toggle tema
  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    saveTheme(newTheme);

    if (newTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  // Manejar cambio de credenciales
  const handleCredentialsChange = (newBotId, newAnswerId, newApiKey) => {
    setBotId(newBotId);
    setAnswerId(newAnswerId);
    setApiKey(newApiKey);
  };

  // Exportar configuración
  const handleExport = () => {
    const result = exportConfig();
    if (result.success) {
      const dataStr = JSON.stringify(result.data, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `builderbot-config-${new Date().toISOString().split('T')[0]}.json`;
      link.click();
      URL.revokeObjectURL(url);
      showToast('Configuración exportada correctamente', 'success');
    } else {
      showToast(result.error, 'error');
    }
  };

  // Importar configuración
  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const result = importConfig(event.target.result);
          if (result.success) {
            showToast('Configuración importada correctamente. Recarga la página.', 'success');
            setTimeout(() => window.location.reload(), 2000);
          } else {
            showToast(result.error, 'error');
          }
        };
        reader.readAsText(file);
      }
    };
    input.click();
  };

  // Limpiar todo
  const handleClear = () => {
    if (window.confirm('¿Estás seguro de que quieres eliminar toda la configuración?')) {
      const result = clearAllStorage();
      if (result.success) {
        showToast('Configuración eliminada. Recargando...', 'success');
        setTimeout(() => window.location.reload(), 1500);
      } else {
        showToast(result.error, 'error');
      }
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10 backdrop-blur-lg bg-opacity-90 dark:bg-opacity-90">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg">
                <Settings className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                  Candidatic IA Settings
                </h1>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <Button
                onClick={handleExport}
                icon={Download}
                variant="outline"
                size="sm"
              >
                Exportar
              </Button>
              <Button
                onClick={handleImport}
                icon={Upload}
                variant="outline"
                size="sm"
              >
                Importar
              </Button>
              <Button
                onClick={handleClear}
                icon={Trash2}
                variant="outline"
                size="sm"
              >
                Limpiar
              </Button>
              <button
                onClick={toggleTheme}
                className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 smooth-transition"
              >
                {theme === 'light' ? (
                  <Moon className="w-5 h-5 text-gray-700 dark:text-gray-300" />
                ) : (
                  <Sun className="w-5 h-5 text-gray-700 dark:text-gray-300" />
                )}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Columna izquierda */}
          <div className="space-y-6">
            <CredentialsSection
              onCredentialsChange={handleCredentialsChange}
              showToast={showToast}
            />

            <ConnectionStatus
              botId={botId}
              apiKey={apiKey}
              showToast={showToast}
            />

            <WebhookConfig
              botId={botId}
              apiKey={apiKey}
              showToast={showToast}
            />
          </div>

          {/* Columna derecha */}
          <div className="space-y-6">
            <EventMonitor showToast={showToast} />

            <QuickTest
              botId={botId}
              apiKey={apiKey}
              showToast={showToast}
            />
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="mt-12 py-6 border-t border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-center text-sm text-gray-500 dark:text-gray-400">
            Candidatic IA v1.0 • Desarrollado con ❤️ para Candidatic
          </p>
        </div>
      </footer>

      {/* Toast notifications */}
      {ToastComponent}
    </div>
  );
}

export default App;
