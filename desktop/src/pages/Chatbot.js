import React, { useState, useEffect, useRef } from 'react';
import { chatbotAPI } from '../services/api';
import { QRCodeSVG } from 'qrcode.react';
import './Chatbot.css';

function Chatbot() {
  const [status, setStatus] = useState(null);
  const [qrString, setQrString] = useState('');
  const [atendimentos, setAtendimentos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [debugInfo, setDebugInfo] = useState('');
  const pollIntervalRef = useRef(null);
  const attemptCountRef = useRef(0);

  useEffect(() => {
    loadStatus();
    loadAtendimentos();
    
    // Auto-refresh atendimentos a cada 60 segundos
    const refreshInterval = setInterval(loadAtendimentos, 60000);
    
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
      clearInterval(refreshInterval);
    };
  }, []);

  const startQRPolling = () => {
    console.log('🔄 Starting QR polling...');
    attemptCountRef.current = 0;
    
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }

    pollIntervalRef.current = setInterval(async () => {
      attemptCountRef.current += 1;
      console.log(`🔄 QR polling attempt #${attemptCountRef.current}`);
      
      try {
        const statusData = await chatbotAPI.getStatus();
        setStatus(statusData);
        setDebugInfo(`Tentativa ${attemptCountRef.current}: Status = ${statusData.status}`);

        if (statusData.status === 'connected') {
          console.log('✅ Connected! Stopping polling.');
          setQrString('');
          clearInterval(pollIntervalRef.current);
          setDebugInfo('✅ Conectado com sucesso!');
          await loadAtendimentos();
          return;
        }

        const qrData = await chatbotAPI.getQRCode();
        console.log('📱 QR response:', {
          hasQRCode: !!qrData.qrCode,
          length: qrData.qrCode?.length || 0
        });
        
        if (qrData.qrCode) {
          console.log('✅ QR Code received!');
          setQrString(qrData.qrCode);
          setDebugInfo(`✅ QR Code recebido! (${qrData.qrCode.length} chars)`);
        } else {
          console.log('⏳ QR Code not ready yet');
          setDebugInfo(`Aguardando QR... Tentativa ${attemptCountRef.current}`);
        }
      } catch (error) {
        console.error('❌ Error polling:', error);
        setDebugInfo(`Erro: ${error.message}`);
      }
    }, 3000);

    setTimeout(() => {
      if (pollIntervalRef.current) {
        console.log('⏹️ Stopping polling after 2 minutes');
        clearInterval(pollIntervalRef.current);
        if (!qrString) {
          setDebugInfo('Timeout: QR Code não foi gerado após 2 minutos.');
        }
      }
    }, 120000);
  };

  const loadQRCode = async () => {
    try {
      console.log('📲 Loading QR Code...');
      const qrData = await chatbotAPI.getQRCode();
      console.log('📱 QR Data received:', {
        hasQRCode: !!qrData.qrCode,
        qrCodeLength: qrData.qrCode?.length || 0,
        keys: Object.keys(qrData)
      });
      
      if (qrData.qrCode) {
        console.log('✅ QR Code received (Base64)!');
        setQrString(qrData.qrCode);
        setDebugInfo(`✅ QR Code carregado! (${qrData.qrCode.length} chars)`);
      } else {
        console.log('⏳ QR Code not available yet');
        setDebugInfo('QR Code ainda não disponível');
      }
    } catch (error) {
      console.error('❌ Error loading QR:', error);
      setDebugInfo(`Erro ao carregar QR: ${error.message}`);
    }
  };

  const loadStatus = async () => {
    try {
      const statusData = await chatbotAPI.getStatus();
      console.log('📊 Status loaded:', statusData);
      setStatus(statusData);
      
      if (statusData.status !== 'connected' && statusData.hasQRString) {
        const qrData = await chatbotAPI.getQRCode();
        if (qrData.qrCode) {
          setQrString(qrData.qrCode);
          setDebugInfo('QR Code já disponível');
        }
      } else if (statusData.status === 'connected') {
        setQrString('');
        setDebugInfo('Conectado ao WhatsApp');
      }
    } catch (error) {
      console.error('❌ Error loading status:', error);
      setDebugInfo(`Erro ao carregar status: ${error.message}`);
    }
  };

  const loadAtendimentos = async () => {
    try {
      const data = await chatbotAPI.getAtendimentos();
      const statusData = await chatbotAPI.getStatus();
      
      // Enriquecer atendimentos com informação de pausa
      const enrichedAtendimentos = data.atendimentos.map(atendimento => {
        const pauseInfo = statusData.chatPauses?.find(
          pause => pause.phone === atendimento.phoneNumber
        );
        
        return {
          ...atendimento,
          isPaused: !!pauseInfo,
          pausedUntil: pauseInfo?.pausedUntil
        };
      });
      
      setAtendimentos(enrichedAtendimentos || []);
    } catch (error) {
      console.error('❌ Error loading atendimentos:', error);
    }
  };

  const handleConectar = async () => {
    setLoading(true);
    setQrString('');
    setDebugInfo('Iniciando conexão...');
    attemptCountRef.current = 0;
    
    try {
      console.log('🚀 Connecting to WhatsApp...');
      const response = await chatbotAPI.conectar();
      console.log('📡 Connect response:', response);
      
      setDebugInfo('Aguardando geração do QR Code...');
      
      await new Promise(resolve => setTimeout(resolve, 5000));
      await loadQRCode();
      startQRPolling();
      await loadStatus();
    } catch (error) {
      console.error('❌ Error connecting:', error);
      alert('Erro ao conectar: ' + error.message);
      setDebugInfo(`Erro: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDesconectar = async () => {
    setLoading(true);
    try {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
      await chatbotAPI.desconectar();
      setQrString('');
      setDebugInfo('Desconectado');
      await loadStatus();
    } catch (error) {
      console.error('❌ Error disconnecting:', error);
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
      console.error('❌ Error pausing:', error);
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
      console.error('❌ Error resuming:', error);
      alert('Erro ao retomar: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePausarChat = async (phoneNumber) => {
    try {
      await chatbotAPI.pausarChat(phoneNumber);
      alert(`✅ Bot pausado para ${phoneNumber}.\nVocê pode responder manualmente agora.`);
      await loadAtendimentos();
    } catch (error) {
      console.error('❌ Error pausing chat:', error);
      alert('Erro ao pausar chat: ' + error.message);
    }
  };

  const handleRetomarChat = async (phoneNumber) => {
    try {
      await chatbotAPI.retomarChat(phoneNumber);
      alert(`✅ Bot retomado para ${phoneNumber}.\nO bot voltará a responder automaticamente.`);
      await loadAtendimentos();
    } catch (error) {
      console.error('❌ Error resuming chat:', error);
      alert('Erro ao retomar chat: ' + error.message);
    }
  };

  const handleManualRefresh = async () => {
    console.log('🔄 Manual refresh requested');
    setDebugInfo('Atualizando manualmente...');
    await loadQRCode();
    await loadStatus();
  };

  const formatStatus = (statusObj) => {
    if (!statusObj) return 'Desconhecido';
    if (statusObj.paused) return `Pausado até ${new Date(statusObj.pausedUntil).toLocaleString('pt-BR')}`;
    
    const statusMap = {
      'disconnected': '🔴 Desconectado',
      'qr_ready': '🟡 QR Code pronto para escanear',
      'authenticated': '🟢 Autenticado',
      'authenticating': '🟡 Autenticando',
      'connected': '🟢 Conectado',
      'auth_failure': '🔴 Falha na autenticação'
    };
    
    return statusMap[statusObj.status] || statusObj.status;
  };

  const formatPausedUntil = (pausedUntil) => {
    if (!pausedUntil) return '';
    const date = new Date(pausedUntil);
    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="chatbot-page">
      <h1>💬 Chatbot WhatsApp</h1>

      <div className="chatbot-controls">
        <div className="status-card">
          <h2>Status</h2>
          <p className="status-text">{formatStatus(status)}</p>
          {status?.hasQRString && (
            <p style={{ fontSize: '12px', color: '#10b981', marginTop: '4px', fontWeight: '600' }}>
              ✅ QR Code disponível
            </p>
          )}
          {debugInfo && (
            <p style={{ fontSize: '11px', color: '#6b7280', marginTop: '8px', fontFamily: 'monospace' }}>
              🔍 Debug: {debugInfo}
            </p>
          )}
        </div>

        <div className="control-buttons">
          <button 
            onClick={handleConectar} 
            disabled={loading || status?.status === 'connected'}
            className="btn btn-primary"
          >
            {loading ? '⏳ Conectando...' : '📱 Conectar WhatsApp'}
          </button>
          {status?.status === 'connected' && (
            <>
              <button 
                onClick={handleDesconectar} 
                disabled={loading}
                className="btn btn-secondary"
              >
                🔌 Desconectar
              </button>
              <button 
                onClick={handlePausar} 
                disabled={loading || status?.paused}
                className="btn btn-warning"
              >
                ⏸️ Pausar Bot (Global)
              </button>
              <button 
                onClick={handleRetomar} 
                disabled={loading || !status?.paused}
                className="btn btn-success"
              >
                ▶️ Retomar Bot (Global)
              </button>
            </>
          )}
        </div>

        {qrString && status?.status !== 'connected' && (
          <div className="qr-code-container" style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '400px',
            textAlign: 'center'
          }}>
            <h3>Escaneie o QR Code com o WhatsApp</h3>
            <div className="qr-code-wrapper" style={{ 
              border: '3px solid #10b981',
              padding: '20px',
              borderRadius: '12px',
              backgroundColor: '#ffffff',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              margin: '20px 0'
            }}>
              {qrString.startsWith('data:image') ? (
                <img src={qrString} alt="QR Code" style={{ maxWidth: '300px', height: 'auto' }} />
              ) : (
                <QRCodeSVG 
                  value={qrString}
                  size={300}
                  level="M"
                  includeMargin={true}
                  bgColor="#ffffff"
                  fgColor="#000000"
                />
              )}
            </div>
            <p className="qr-instruction" style={{ marginTop: '16px', fontSize: '14px' }}>
              <strong>Como escanear:</strong><br/>
              1. Abra o WhatsApp no celular<br/>
              2. Menu (⋮) → Dispositivos conectados<br/>
              3. Conectar dispositivo → Aponte para o QR Code acima
            </p>
            <button 
              onClick={handleManualRefresh}
              className="btn btn-secondary"
              style={{ marginTop: '12px', padding: '8px 16px', fontSize: '13px' }}
            >
              🔄 Atualizar QR Code
            </button>
          </div>
        )}

        {!qrString && status?.status !== 'connected' && status?.status !== 'disconnected' && status?.status !== null && (
          <div className="qr-code-container">
            <div style={{ padding: '40px', textAlign: 'center' }}>
              <div className="spinner" style={{ 
                border: '4px solid #f3f3f3',
                borderTop: '4px solid #007bff',
                borderRadius: '50%',
                width: '50px',
                height: '50px',
                animation: 'spin 1s linear infinite',
                margin: '0 auto 20px'
              }}></div>
              <p className="qr-instruction" style={{ fontSize: '16px', marginBottom: '8px' }}>
                ⏳ Aguardando QR Code do backend...
              </p>
              <p style={{ fontSize: '13px', color: '#6b7280' }}>
                Tentativa: {attemptCountRef.current}
              </p>
              <button 
                onClick={handleManualRefresh}
                className="btn btn-secondary"
                style={{ marginTop: '16px', padding: '8px 16px', fontSize: '13px' }}
              >
                🔄 Tentar Buscar Agora
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="atendimentos-section">
        <h2>📋 Atendimentos</h2>
        <button 
          onClick={loadAtendimentos}
          className="btn btn-secondary"
          style={{ marginBottom: '16px', padding: '8px 16px', fontSize: '13px' }}
        >
          🔄 Atualizar Atendimentos
        </button>
        {atendimentos.length === 0 ? (
          <p style={{ color: '#6b7280' }}>Nenhum atendimento ainda</p>
        ) : (
          <div className="atendimentos-list">
            {atendimentos.map(atendimento => (
              <div 
                key={atendimento.id} 
                className={`atendimento-card ${atendimento.isPaused ? 'paused' : 'active'}`}
                style={{
                  border: '1px solid #e5e7eb',
                  borderLeft: `4px solid ${atendimento.isPaused ? '#ffc107' : '#28a745'}`,
                  borderRadius: '8px',
                  padding: '16px',
                  marginBottom: '12px',
                  backgroundColor: atendimento.isPaused ? '#fff9e6' : '#ffffff',
                  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)'
                }}
              >
                <div className="atendimento-header" style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '8px'
                }}>
                  <span className="atendimento-phone" style={{ fontWeight: '600', fontSize: '16px' }}>
                    📞 {atendimento.phoneNumber}
                  </span>
                  <span className="atendimento-state" style={{
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontSize: '12px',
                    fontWeight: '500',
                    backgroundColor: atendimento.state === 'initial' ? '#fef3c7' : '#d1fae5',
                    color: atendimento.state === 'initial' ? '#92400e' : '#065f46'
                  }}>
                    {atendimento.state}
                  </span>
                </div>
                
                {atendimento.isPaused && (
                  <div style={{
                    padding: '8px',
                    backgroundColor: '#ffc107',
                    color: '#000',
                    borderRadius: '4px',
                    fontSize: '12px',
                    marginBottom: '8px',
                    fontWeight: '500'
                  }}>
                    ⏸️ Atendimento Manual até {formatPausedUntil(atendimento.pausedUntil)}
                  </div>
                )}
                
                <div className="atendimento-meta" style={{ fontSize: '14px', color: '#6b7280', marginBottom: '12px' }}>
                  <small>🕒 {new Date(atendimento.createdAt).toLocaleString('pt-BR')}</small>
                  {atendimento.metadata && Object.keys(atendimento.metadata).length > 0 && (
                    <div style={{ marginTop: '8px', fontSize: '12px' }}>
                      <strong>Dados:</strong> {JSON.stringify(atendimento.metadata, null, 2)}
                    </div>
                  )}
                </div>
                
                <div className="atendimento-actions" style={{
                  display: 'flex',
                  gap: '8px'
                }}>
                  {!atendimento.isPaused ? (
                    <button 
                      onClick={() => handlePausarChat(atendimento.phoneNumber)}
                      className="btn btn-warning"
                      style={{
                        padding: '6px 12px',
                        fontSize: '13px',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer'
                      }}
                    >
                      ⏸️ Assumir Atendimento
                    </button>
                  ) : (
                    <button 
                      onClick={() => handleRetomarChat(atendimento.phoneNumber)}
                      className="btn btn-success"
                      style={{
                        padding: '6px 12px',
                        fontSize: '13px',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer'
                      }}
                    >
                      ▶️ Liberar Bot
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        
        .atendimento-card.paused {
          animation: pulse-yellow 2s ease-in-out infinite;
        }
        
        .atendimento-card.active {
          animation: pulse-green 2s ease-in-out infinite;
        }
        
        @keyframes pulse-yellow {
          0%, 100% { box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1); }
          50% { box-shadow: 0 4px 8px rgba(255, 193, 7, 0.3); }
        }
        
        @keyframes pulse-green {
          0%, 100% { box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1); }
          50% { box-shadow: 0 4px 8px rgba(40, 167, 69, 0.2); }
        }
      `}</style>
    </div>
  );
}

export default Chatbot;