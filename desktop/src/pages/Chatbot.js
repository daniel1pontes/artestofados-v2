import React, { useState, useEffect } from 'react';
import { chatbotAPI } from '../services/api';
import './Chatbot.css';

function Chatbot() {
  const [status, setStatus] = useState(null);
  const [qrCode, setQrCode] = useState('');
  const [atendimentos, setAtendimentos] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadQRCode = async () => {
    try {
      const qrData = await chatbotAPI.getQRCode();
      console.log('QR Data received:', qrData);
      if (qrData.qrCode) {
        setQrCode(qrData.qrCode);
        console.log('QR Code set, length:', qrData.qrCode.length);
      }
    } catch (error) {
      console.error('Error loading QR code:', error);
    }
  };

  useEffect(() => {
    loadStatus();
    loadAtendimentos();
    loadQRCode();
    const interval = setInterval(() => {
      loadStatus();
      loadAtendimentos();
      loadQRCode();
    }, 2000); // Poll every 2 seconds for QR code updates
    return () => clearInterval(interval);
  }, []);

  const loadStatus = async () => {
    try {
      const statusData = await chatbotAPI.getStatus();
      setStatus(statusData);
      const qrData = await chatbotAPI.getQRCode();
      if (qrData.qrCode) setQrCode(qrData.qrCode);
    } catch (error) {
      console.error('Error loading status:', error);
    }
  };

  const loadAtendimentos = async () => {
    try {
      const data = await chatbotAPI.getAtendimentos();
      setAtendimentos(data.atendimentos || []);
    } catch (error) {
      console.error('Error loading atendimentos:', error);
    }
  };

  const handleConectar = async () => {
    setLoading(true);
    try {
      await chatbotAPI.conectar();
      // Start polling for QR code
      const qrInterval = setInterval(async () => {
        const qrData = await chatbotAPI.getQRCode();
        if (qrData.qrCode) {
          setQrCode(qrData.qrCode);
        }
      }, 1000);
      
      // Stop polling after 5 minutes
      setTimeout(() => clearInterval(qrInterval), 300000);
      
      await loadStatus();
    } catch (error) {
      console.error('Error connecting:', error);
      alert('Erro ao conectar: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDesconectar = async () => {
    setLoading(true);
    try {
      await chatbotAPI.desconectar();
      await loadStatus();
    } catch (error) {
      console.error('Error disconnecting:', error);
      alert('Erro ao desconectar: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePausar = async () => {
    setLoading(true);
    try {
      await chatbotAPI.pausar();
      await loadStatus();
    } catch (error) {
      console.error('Error pausing:', error);
      alert('Erro ao pausar: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRetomar = async () => {
    setLoading(true);
    try {
      await chatbotAPI.retomar();
      await loadStatus();
    } catch (error) {
      console.error('Error resuming:', error);
      alert('Erro ao retomar: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const formatStatus = (statusObj) => {
    if (!statusObj) return 'Desconhecido';
    if (statusObj.paused) return `Pausado até ${new Date(statusObj.pausedUntil).toLocaleString('pt-BR')}`;
    return statusObj.status;
  };

  return (
    <div className="chatbot-page">
      <h1>💬 Chatbot</h1>

      <div className="chatbot-controls">
        <div className="status-card">
          <h2>Status</h2>
          <p className="status-text">{formatStatus(status)}</p>
        </div>

        <div className="control-buttons">
          <button 
            onClick={handleConectar} 
            disabled={loading || status?.status === 'connected'}
            className="btn btn-primary"
          >
            Conectar WhatsApp
          </button>
          <button 
            onClick={handleDesconectar} 
            disabled={loading || status?.status !== 'connected'}
            className="btn btn-secondary"
          >
            Desconectar
          </button>
          <button 
            onClick={handlePausar} 
            disabled={loading || status?.status !== 'connected' || status?.paused}
            className="btn btn-warning"
          >
            Pausar Bot
          </button>
          <button 
            onClick={handleRetomar} 
            disabled={loading || !status?.paused}
            className="btn btn-success"
          >
            Retomar Bot
          </button>
        </div>

        {qrCode && status?.status !== 'connected' && (
          <div className="qr-code-container">
            <h3>Escaneie o QR Code com o WhatsApp</h3>
            <div className="qr-code-wrapper">
              <div dangerouslySetInnerHTML={{ __html: qrCode }} />
            </div>
            <p className="qr-instruction">Abra o WhatsApp no celular → Menu → Dispositivos conectados → Conectar dispositivo</p>
          </div>
        )}
      </div>

      <div className="atendimentos-section">
        <h2>Atendimentos</h2>
        {atendimentos.length === 0 ? (
          <p>Nenhum atendimento ainda</p>
        ) : (
          <div className="atendimentos-list">
            {atendimentos.map(atendimento => (
              <div key={atendimento.id} className="atendimento-card">
                <div className="atendimento-header">
                  <span className="atendimento-phone">{atendimento.phoneNumber}</span>
                  <span className="atendimento-state">{atendimento.state}</span>
                </div>
                <div className="atendimento-meta">
                  <small>{new Date(atendimento.createdAt).toLocaleString('pt-BR')}</small>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default Chatbot;

