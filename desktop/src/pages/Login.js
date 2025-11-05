import React, { useState } from 'react';
import './Login.css';

function Login({ onSuccess }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    await new Promise((r) => setTimeout(r, 400));
    let users = [];
    try {
      const raw = localStorage.getItem('users');
      users = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(users)) users = [];
    } catch {
      users = [];
    }
    if (users.length === 0) {
      users = [{ username: 'nicholas123', password: 'EstofadosNicholas10' }];
      localStorage.setItem('users', JSON.stringify(users));
    }

    const ok = users.some(u => u.username === username && u.password === password);
    if (ok) onSuccess(); else setError('Usuário ou senha inválidos.');

    setLoading(false);
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-header">
          <img src="/icon.png" alt="Logo Artestofados" className="login-logo" />
          <div className="login-title">Acesso Restrito</div>
          <div className="login-subtitle">Entre com suas credenciais</div>
        </div>

        <form className="form" onSubmit={handleSubmit}>
          <div className="field">
            <label className="label">Usuário</label>
            <input
              className="input"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Digite seu usuário"
            />
          </div>

          <div className="field">
            <label className="label">Senha</label>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Digite sua senha"
            />
          </div>

          {error && <div className="error">{error}</div>}

          <button className="button" type="submit" disabled={loading}>
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>

        <div className="footer-hint">© Artestofados</div>
      </div>
    </div>
  );
}

export default Login;
