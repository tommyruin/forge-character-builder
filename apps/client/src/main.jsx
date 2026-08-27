import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@shell/styles.css'
import { shell } from '@shell'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <shell.ReleaseNotesProvider announce={import.meta.env.VITE_PUBLIC_RELEASE === 'true'}>
      <App />
    </shell.ReleaseNotesProvider>
  </StrictMode>,
)
