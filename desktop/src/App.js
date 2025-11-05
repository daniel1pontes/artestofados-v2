import React, { useState } from 'react';
import Sidebar from './components/Sidebar';
import Chatbot from './pages/Chatbot';
import GerarOS from './pages/GerarOS';
import BancoOS from './pages/BancoOS';
import Login from './pages/Login';
import './App.css';

function App() {
  const [isAuthed, setIsAuthed] = useState(false);
  const [activeTab, setActiveTab] = useState('login');

  const renderContent = () => {
    switch (activeTab) {
      case 'login':
        return <Login onSuccess={() => { setIsAuthed(true); setActiveTab('chatbot'); }} />;
      case 'chatbot':
        return isAuthed ? <Chatbot /> : <Login onSuccess={() => { setIsAuthed(true); setActiveTab('chatbot'); }} />;
      case 'gerar':
        return isAuthed ? <GerarOS /> : <Login onSuccess={() => { setIsAuthed(true); setActiveTab('chatbot'); }} />;
      case 'banco':
        return isAuthed ? <BancoOS /> : <Login onSuccess={() => { setIsAuthed(true); setActiveTab('chatbot'); }} />;
      default:
        return isAuthed ? <Chatbot /> : <Login onSuccess={() => { setIsAuthed(true); setActiveTab('chatbot'); }} />;
    }
  };

  return (
    <div className="app">
      {isAuthed && (
        <Sidebar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onLogout={() => { setIsAuthed(false); setActiveTab('login'); }}
        />
      )}
      <main className="main-content">
        {renderContent()}
      </main>
    </div>
  );
}

export default App;

