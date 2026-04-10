import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthProvider } from './contexts/AuthContext'
import './index.css'
import App from './App.jsx'

// Sleduj visualViewport — když se otevře klávesnice (iOS Chrome aj.),
// nastav CSS proměnnou --kb-height s výškou klávesnice.
if (window.visualViewport) {
  const update = () => {
    const kbHeight = window.innerHeight - window.visualViewport.height;
    document.documentElement.style.setProperty('--kb-height', `${kbHeight}px`);
  };
  window.visualViewport.addEventListener('resize', update);
  window.visualViewport.addEventListener('scroll', update);
  update();
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
)
