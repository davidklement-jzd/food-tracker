import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

// Zobrazí se, když uživatel přijde přes odkaz z resetovacího e-mailu
// (recoveryMode v AuthContext). Nastaví nové heslo a vrátí ho na přihlášení.
export default function ResetPasswordPage() {
  const { updatePassword, signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (password.length < 6) {
      setError('Heslo musí mít alespoň 6 znaků.');
      return;
    }
    if (password !== confirm) {
      setError('Hesla se neshodují.');
      return;
    }

    setLoading(true);
    const { error } = await updatePassword(password);
    setLoading(false);

    if (error) {
      setError(error.message);
    } else {
      setDone(true);
    }
  }

  if (done) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <img src="/icon-192.png" alt="Logo" style={{ width: 160, height: 160, marginBottom: 0, display: 'block', marginLeft: 'auto', marginRight: 'auto', transform: 'translateX(-10px)' }} />
          <h1 className="auth-title">Jak na zdravé tělo</h1>
          <p className="auth-subtitle">Heslo změněno</p>
          <div className="auth-success">Nové heslo je nastavené. Teď se s ním můžete přihlásit.</div>
          <button className="auth-btn" style={{ marginTop: 12 }} onClick={signOut}>
            Přejít na přihlášení
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <img src="/icon-192.png" alt="Logo" style={{ width: 160, height: 160, marginBottom: 0, display: 'block', marginLeft: 'auto', marginRight: 'auto', transform: 'translateX(-10px)' }} />
        <h1 className="auth-title">Jak na zdravé tělo</h1>
        <p className="auth-subtitle">Nastavit nové heslo</p>

        <form onSubmit={handleSubmit} className="auth-form">
          <input
            type="password"
            placeholder="Nové heslo"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="auth-input"
            autoComplete="new-password"
            minLength={6}
            required
          />
          <input
            type="password"
            placeholder="Nové heslo znovu"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="auth-input"
            autoComplete="new-password"
            minLength={6}
            required
          />

          {error && <div className="auth-error">{error}</div>}

          <button type="submit" className="auth-btn" disabled={loading}>
            {loading ? '...' : 'Uložit nové heslo'}
          </button>
        </form>
      </div>
    </div>
  );
}
