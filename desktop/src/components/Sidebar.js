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
        <h1>OS Management</h1>
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

