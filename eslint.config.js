import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // scripts/debug: diagnósticos desechables de un solo uso, no código de producción
  globalIgnores(['dist', 'scripts/debug']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      // caughtErrors/allowEmptyCatch: el patrón fire-and-forget del proyecto usa
      // `catch (e) {}` a propósito (telemetría, logs, SSE) — no es negligencia.
      // ignoreRestSiblings: permite el idioma `const { campo, ...resto } = obj` para excluir campos
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Reglas advisory del compilador de React (react-hooks v6): marcan patrones que este
      // repo usa A PROPÓSITO y que están estables en producción — refs durante render para
      // la animación de entrada del chat (MessageBubble), setState de sincronización dentro
      // de effects, y arrays de deps afinados a mano (ver CLAUDE.md: el bug #7 de presencia
      // se arregló justamente ajustando deps a mano). "Corregirlas" = refactors de riesgo
      // sin beneficio funcional. Se desactivan hasta que haya un refactor deliberado.
      // OJO: 'react-hooks/static-components' se queda ACTIVA — esa sí caza bugs reales
      // (fue la causa del temblor del chat con el Footer inline de Virtuoso).
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/exhaustive-deps': 'off',
      // Solo afecta el hot-reload de desarrollo (contexts exportan hooks + componente juntos)
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    // Backend (funciones serverless de Vercel) y scripts: corren en Node, no en navegador
    files: ['api/**/*.js', 'scripts/**/*.js', 'vite.config.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
])
