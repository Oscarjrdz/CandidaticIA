import React, { useState, useEffect } from 'react';
import { Moon, Sun, Download, Upload, Trash2 } from 'lucide-react';
import { useToast } from './hooks/useToast';
import Button from './components/ui/Button';
import Sidebar from './components/Sidebar';
import CandidatesSection from './components/CandidatesSection';
import HistorySection from './components/HistorySection';
import SettingsSection from './components/SettingsSection';
import AssistantSection from './components/AssistantSection';
import AutomationsSection from './components/AutomationsSection';
import VacanciesSection from './components/VacanciesSection';
import BulksSection from './components/BulksSection';
import UsersSection from './components/UsersSection';
import { getTheme, saveTheme, exportConfig, importConfig, clearAllStorage } from './utils/storage';



function App() {
  const [botId, setBotId] = useState('');
  const [answerId, setAnswerId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [theme, setTheme] = useState('light');
  const [activeSection, setActiveSection] = useState('candidates');
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
      link.download = `candidatic-config-${new Date().toISOString().split('T')[0]}.json`;
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
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 flex">
      {/* Sidebar */}
      <Sidebar
        activeSection={activeSection}
        onSectionChange={setActiveSection}
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10 backdrop-blur-lg bg-opacity-90 dark:bg-opacity-90">
          <div className="px-8 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                  {activeSection === 'candidates' ? 'Candidatos'
                    : activeSection === 'assistant' ? 'Update Bot'
                      : activeSection === 'automations' ? 'Automatizaciones'
                        : activeSection === 'vacancies' ? 'Vacantes'
                          : activeSection === 'history' ? 'Historial'
                            : activeSection === 'bulks' ? 'Bulks'
                              : activeSection === 'users' ? 'Usuarios'
                                : 'Configuración'}
                </h1>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {activeSection === 'candidates' ? 'Gestión de candidatos de WhatsApp'
                    : activeSection === 'assistant' ? 'Gestión del Prompt y Archivos del Asistente'
                      : activeSection === 'bulks' ? 'Envío Masivo de Mensajes'
                        : activeSection === 'users' ? 'Gestión de equipo y permisos'
                          : 'Configuración de BuilderBot API'
                  }
                </p>
              </div>

              <div className="flex items-center space-x-2">
                {activeSection === 'settings' && (
                  <>
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
                  </>
                )}
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

        {/* Content Area */}
        <main className="flex-1 px-8 py-8 overflow-y-auto">
          {activeSection === 'candidates' ? (
            <CandidatesSection showToast={showToast} />
          ) : activeSection === 'history' ? (
            <HistorySection showToast={showToast} />
          ) : activeSection === 'assistant' ? (
            <AssistantSection showToast={showToast} />
          ) : activeSection === 'automations' ? (
            <AutomationsSection showToast={showToast} />
          ) : activeSection === 'vacancies' ? (
            <VacanciesSection showToast={showToast} />
          ) : activeSection === 'bulks' ? (
            <BulksSection showToast={showToast} />
          ) : activeSection === 'users' ? (
            <UsersSection showToast={showToast} />
          ) : (
            <SettingsSection
              botId={botId}
              apiKey={apiKey}
              onCredentialsChange={handleCredentialsChange}
              showToast={showToast}
            />
          )}
        </main>

        {/* Footer */}
        <footer className="py-4 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
          <div className="px-8">
            <p className="text-center text-sm text-gray-500 dark:text-gray-400">
              Candidatic IA v1.0 • Desarrollado con ❤️ para Candidatic
            </p>
          </div>
        </footer>
      </div>

      {/* Toast notifications */}
      {ToastComponent}
    </div>
  );
}

export default App;
