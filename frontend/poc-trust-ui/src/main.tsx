import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted variable fonts — bundled at build time, fully offline after install.
import '@fontsource-variable/inter'
import '@fontsource-variable/sora'
import '@fontsource-variable/jetbrains-mono'
import './index.css'
import App from './App.tsx'
import { initI18n } from './i18n'

// The English catalog (source of truth and mandatory fallback) is bundled; the operator's
// locale is resolved before first paint so <html lang> and the first render agree.
await initI18n()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
