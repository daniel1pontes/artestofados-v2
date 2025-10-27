import React, { useState } from 'react';
import Sidebar from './components/Sidebar';
import Chatbot from './pages/Chatbot';
import GerarOS from './pages/GerarOS';
import BancoOS from './pages/BancoOS';
import './App.css';

function App() {
  const [activeTab, setActiveTab] = useState('chatbot');

  const renderContent = () => {
    switch (activeTab) {
      case 'chatbot':
        return <Chatbot />;
      case 'gerar':
        return <GerarOS />;
      case 'banco':
        return <BancoOS />;
      default:
        return <Chatbot />;
    }
  };

  return (
    <div className="app">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      <main className="main-content">
        {renderContent()}
      </main>
    </div>
  );
}

export default App;

