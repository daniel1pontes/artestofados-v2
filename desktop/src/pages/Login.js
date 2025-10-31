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

    // Simple client-side check with provided defaults
    const validUser = 'nicholas123';
    const validPass = 'EstofadosNicholas10';

    // Simulate small delay for UX
    await new Promise((r) => setTimeout(r, 400));

    if (username === validUser && password === validPass) {
      onSuccess();
    } else {
      setError('Usuário ou senha inválidos.');
    }

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
