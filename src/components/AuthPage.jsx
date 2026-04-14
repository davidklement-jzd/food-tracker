import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

export default function AuthPage() {
  const { signIn, signUp } = useAuth();
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');

  // Extract just the code from a full URL or raw code
  function parseInviteCode(value) {
    if (!value) return '';
    try {
      const url = new URL(value);
      return url.searchParams.get('invite') || value.trim();
    } catch {
      return value.trim();
    }
  }

  // Read invite code from URL and auto-switch to registration
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('invite');
    if (code) {
      setInviteCode(code);
      setIsRegister(true);
      // Clean URL without reload
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

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
      if (!inviteCode.trim()) {
        setError('Registrace vyžaduje pozvánkový kód od trenéra.');
        setLoading(false);
        return;
      }
      const { error } = await signUp(email, password, displayName.trim(), inviteCode.trim());
      if (error) {
        // Supabase wraps trigger exceptions as generic "Database error saving new user"
        if (error.message?.includes('Database error') || error.message?.includes('pozvánkový') || error.message?.includes('invite')) {
          setError('Pozvánkový kód je neplatný, vypršel nebo už byl použit.');
        } else {
          setError(error.message);
        }
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
            <>
              <input
                type="text"
                placeholder="Pozvánkový kód"
                value={inviteCode}
                onChange={(e) => setInviteCode(parseInviteCode(e.target.value))}
                className="auth-input"
                style={inviteCode ? { backgroundColor: '#f0f9f0', color: '#2d6a2e' } : undefined}
              />
              <input
                type="text"
                placeholder="Jméno a příjmení"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="auth-input"
                autoComplete="name"
              />
            </>
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
