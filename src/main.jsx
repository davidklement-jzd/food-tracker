import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthProvider } from './contexts/AuthContext'
import './index.css'
import App from './App.jsx'

// Aplikuje preferenci "Větší písmo" před prvním renderem, ať to neproblikne.
// Třída na <html>, ne <body> — Chrome Android jinak ignoruje text-size-adjust.
if (typeof window !== 'undefined' && localStorage.getItem('large_text') === '1') {
  document.documentElement.classList.add('large-text');
}


createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
)
