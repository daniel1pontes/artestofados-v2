import React, { useEffect, useMemo, useState } from 'react';
import './Usuarios.css';

function Usuarios() {
  const storageKey = 'users';
  const [users, setUsers] = useState([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [selectedUser, setSelectedUser] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const loadUsers = () => {
    try {
      const raw = localStorage.getItem(storageKey);
      const arr = raw ? JSON.parse(raw) : [];
      setUsers(Array.isArray(arr) ? arr : []);
    } catch {
      setUsers([]);
    }
  };

  const saveUsers = (arr) => {
    localStorage.setItem(storageKey, JSON.stringify(arr));
    setUsers(arr);
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const canAdd = useMemo(() => username.trim() && password.trim(), [username, password]);
  const canChange = useMemo(() => selectedUser && newPassword.trim(), [selectedUser, newPassword]);

  const handleAdd = (e) => {
    e.preventDefault();
    if (!canAdd) return;
    const exists = users.some(u => u.username.toLowerCase() === username.trim().toLowerCase());
    if (exists) {
      alert('Usuário já existe.');
      return;
    }
    const next = [...users, { username: username.trim(), password }];
    saveUsers(next);
    setUsername('');
    setPassword('');
    alert('Usuário adicionado.');
  };

  const handleDelete = (u) => {
    if (!window.confirm(`Excluir o usuário ${u.username}?`)) return;
    const next = users.filter(x => x.username !== u.username);
    saveUsers(next);
    if (selectedUser === u.username) setSelectedUser('');
    alert('Usuário excluído.');
  };

  const handleChangePassword = (e) => {
    e.preventDefault();
    if (!canChange) return;
    const idx = users.findIndex(u => u.username === selectedUser);
    if (idx === -1) {
      alert('Usuário não encontrado.');
      return;
    }
    const next = users.slice();
    next[idx] = { ...next[idx], password: newPassword };
    saveUsers(next);
    setNewPassword('');
    alert('Senha atualizada.');
  };

  return (
    <div className="usuarios-page">
      <h1>Gestão de Usuários</h1>

      <div className="usuarios-grid">
        <div className="card">
          <h2>Adicionar Usuário</h2>
          <form onSubmit={handleAdd} className="form">
            <div className="field">
              <label>Usuário</label>
              <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Nome de usuário" />
            </div>
            <div className="field">
              <label>Senha</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Senha" />
            </div>
            <button className="btn" type="submit" disabled={!canAdd}>Adicionar</button>
          </form>
        </div>

        <div className="card">
          <h2>Alterar Senha</h2>
          <form onSubmit={handleChangePassword} className="form">
            <div className="field">
              <label>Usuário</label>
              <select value={selectedUser} onChange={(e) => setSelectedUser(e.target.value)}>
                <option value="">Selecione</option>
                {users.map(u => (
                  <option key={u.username} value={u.username}>{u.username}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Nova Senha</label>
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Nova senha" />
            </div>
            <button className="btn" type="submit" disabled={!canChange}>Atualizar</button>
          </form>
        </div>

        <div className="card">
          <h2>Usuários</h2>
          {users.length === 0 ? (
            <div className="empty">Nenhum usuário</div>
          ) : (
            <ul className="user-list">
              {users.map(u => (
                <li key={u.username} className="user-item">
                  <span className="user-name">{u.username}</span>
                  <button className="btn-danger" onClick={() => handleDelete(u)}>Excluir</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export default Usuarios;
