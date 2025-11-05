import React from 'react';
import './Sidebar.css';

function Sidebar({ activeTab, setActiveTab, onLogout }) {
  const tabs = [
    { id: 'chatbot', label: 'Chatbot' },
    { id: 'gerar', label: 'Gerar OS' },
    { id: 'banco', label: 'Banco de OS' },
    { id: 'usuarios', label: 'Usuários' },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="logo-container">
          <img 
            src="/icon.png" 
            alt="Logo da Empresa" 
            className="company-logo"
            onError={(e) => {
              e.target.style.display = 'none';
              e.target.nextSibling.style.display = 'block';
            }}
          />
          <div className="logo-placeholder" style={{ display: 'none' }}>
            🏢
          </div>
        </div>
        <h1>Sistema Artestofados</h1>
      </div>
      <nav className="sidebar-nav">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`nav-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="nav-label">{tab.label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">
        <button className="logout-btn" onClick={onLogout}>Sair</button>
      </div>
    </aside>
  );
}

export default Sidebar;

