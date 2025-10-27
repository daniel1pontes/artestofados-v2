import React from 'react';
import './Sidebar.css';

function Sidebar({ activeTab, setActiveTab }) {
  const tabs = [
    { id: 'chatbot', label: 'Chatbot', icon: '💬' },
    { id: 'gerar', label: 'Gerar OS', icon: '📝' },
    { id: 'banco', label: 'Banco de OS', icon: '📦' },
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
            <span className="nav-icon">{tab.icon}</span>
            <span className="nav-label">{tab.label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}

export default Sidebar;

