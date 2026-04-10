import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthProvider } from './contexts/AuthContext'
import './index.css'
import App from './App.jsx'

// Sleduj visualViewport — když se otevře klávesnice (iOS Chrome aj.),
// nastav CSS proměnnou --vv-height se skutečnou viditelnou výškou.
if (window.visualViewport) {
  const update = () => {
    document.documentElement.style.setProperty(
      '--vv-height', `${window.visualViewport.height}px`
    );
  };
  window.visualViewport.addEventListener('resize', update);
  update();
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
)
