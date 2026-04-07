import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

export default function AuthPage() {
  const { signIn, signUp } = useAuth();
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    if (isRegister) {
      if (!displayName.trim()) {
        setError('Vyplňte jméno.');
        setLoading(false);
        return;
      }
      const { error } = await signUp(email, password, displayName.trim());
      if (error) {
        setError(error.message);
      } else {
        setSuccess('Registrace proběhla. Zkontrolujte email pro potvrzení.');
      }
    } else {
      const { error } = await signIn(email, password);
      if (error) {
        setError('Nesprávný email nebo heslo.');
      }
    }
    setLoading(false);
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <img src="/icon-192.png" alt="Logo" style={{ width: 160, height: 160, marginBottom: 0, display: 'block', marginLeft: 'auto', marginRight: 'auto', transform: 'translateX(-10px)' }} />
        <h1 className="auth-title">Jak na zdravé tělo</h1>
        <p className="auth-subtitle">
          {isRegister ? 'Vytvořit účet' : 'Přihlášení'}
        </p>

        <form onSubmit={handleSubmit} className="auth-form">
          {isRegister && (
            <input
              type="text"
              placeholder="Vaše jméno"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="auth-input"
              autoComplete="name"
            />
          )}
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="auth-input"
            autoComplete="email"
            required
          />
          <input
            type="password"
            placeholder="Heslo"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="auth-input"
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            minLength={6}
            required
          />

          {error && <div className="auth-error">{error}</div>}
          {success && <div className="auth-success">{success}</div>}

          <button type="submit" className="auth-btn" disabled={loading}>
            {loading
              ? '...'
              : isRegister
                ? 'Zaregistrovat se'
                : 'Přihlásit se'}
          </button>
        </form>

        <button
          className="auth-toggle"
          onClick={() => {
            setIsRegister(!isRegister);
            setError('');
            setSuccess('');
          }}
        >
          {isRegister
            ? 'Už máte účet? Přihlásit se'
            : 'Nemáte účet? Zaregistrovat se'}
        </button>
      </div>
    </div>
  );
}
