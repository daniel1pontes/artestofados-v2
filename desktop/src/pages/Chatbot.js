import React, { useState, useEffect, useRef, useCallback } from 'react';
import { chatbotAPI, appointmentsAPI, agendamentosAPI } from '../services/api';
import { QRCodeSVG } from 'qrcode.react';
import './Chatbot.css';

function Chatbot() {
  const [status, setStatus] = useState(null);
  const [qrString, setQrString] = useState('');
  const [loading, setLoading] = useState(false);
  const [debugInfo, setDebugInfo] = useState('');
  const [appointments, setAppointments] = useState([]);
  const [loadingAppointments, setLoadingAppointments] = useState(false);
  const [filterDate, setFilterDate] = useState(''); // YYYY-MM-DD
  const pollIntervalRef = useRef(null);
  const attemptCountRef = useRef(0);

  const loadAppointments = useCallback(async () => {
    try {
      setLoadingAppointments(true);
      let itemsResp = null;
      try {
        const params = {};
        if (filterDate) {
          const from = new Date(filterDate + 'T00:00:00');
          const to = new Date(filterDate + 'T23:59:59');
          params.from = from.toISOString();
          params.to = to.toISOString();
        }
        const resp = await agendamentosAPI.listar(params);
        itemsResp = resp.items;
      } catch (e) {
        const r2 = await appointmentsAPI.listar();
        itemsResp = r2.items;
      }
      let items = itemsResp || [];
      // Ordenar por proximidade da data atual
      const now = Date.now();
      items.sort((a, b) => {
        const sa = new Date(a.data || a.start_time).getTime();
        const sb = new Date(b.data || b.start_time).getTime();
        const da = Math.abs(sa - now);
        const db = Math.abs(sb - now);
        return da - db;
      });
      setAppointments(items);
    } catch (error) {
      console.error('❌ Error loading appointments:', error);
    } finally {
      setLoadingAppointments(false);
    }
  }, [filterDate]);

  useEffect(() => {
    loadStatus();
    loadAppointments();
    
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  // Auto-refresh agendamentos periodicamente para refletir marcações do cliente
  useEffect(() => {
    const id = setInterval(() => {
      loadAppointments();
    }, 10000);
    return () => clearInterval(id);
  }, [loadAppointments]);

  // Auto-refresh appointments when filters change
  useEffect(() => {
    loadAppointments();
  }, [loadAppointments]);

  // Auto-refresh QR code every 15s when not connected
  useEffect(() => {
    if (status?.status === 'connected') return;
    const id = setInterval(() => {
      loadQRCode();
    }, 15000);
    return () => clearInterval(id);
  }, [status?.status]);

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


  const handleDeleteAppointment = async (id) => {
    if (!window.confirm('Tem certeza que deseja cancelar este agendamento?')) return;
    try {
      await appointmentsAPI.deletar(id);
      await loadAppointments();
      alert('✅ Agendamento cancelado com sucesso');
    } catch (error) {
      alert('Erro ao cancelar: ' + (error.response?.data?.error || error.message));
    }
  };

  const handleUpdateAppointment = async (id, current) => {
    const newDate = prompt('Nova data (dd/mm ou dd/mm/aaaa):', new Date(current.start_time).toLocaleDateString('pt-BR'));
    if (newDate == null) return;
    const newTime = prompt('Novo horário (HH:mm):', new Date(current.start_time).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
    if (newTime == null) return;
    const newSummary = prompt('Novo resumo (opcional):', current.summary);

    try {
      // Parse simples dd/mm(/aaaa) + HH:mm
      const [d, m, y] = newDate.split('/');
      const [hh, mm] = newTime.split(':');
      const base = new Date(current.start_time);
      const year = y ? parseInt(y, 10) : base.getFullYear();
      const start = new Date(year, parseInt(m, 10) - 1, parseInt(d, 10), parseInt(hh, 10), parseInt(mm, 10), 0, 0);
      const durationMs = new Date(current.end_time).getTime() - new Date(current.start_time).getTime();
      const end = new Date(start.getTime() + durationMs);

      await appointmentsAPI.atualizar(id, {
        summary: newSummary || undefined,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
      });
      await loadAppointments();
      alert('✅ Agendamento atualizado');
    } catch (error) {
      alert('Erro ao atualizar: ' + (error.response?.data?.error || error.message));
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
      alert('✅ Bot pausado globalmente. Todas as mensagens serão ignoradas até retomar.');
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
      alert('✅ Bot retomado! Voltou a responder automaticamente.');
    } catch (error) {
      console.error('❌ Error resuming:', error);
      alert('Erro ao retomar: ' + error.message);
    } finally {
      setLoading(false);
    }
  };


  const formatStatus = (statusObj) => {
    if (!statusObj) return 'Desconhecido';
    if (statusObj.paused) return `🟡 Pausado até ${new Date(statusObj.pausedUntil).toLocaleString('pt-BR')}`;
    
    const statusMap = {
      'disconnected': '🔴 Desconectado',
      'qr_ready': '🟡 QR Code pronto para escanear',
      'authenticated': '🟢 Autenticado',
      'authenticating': '🟡 Autenticando',
      'connected': '🟢 Conectado e Ativo',
      'auth_failure': '🔴 Falha na autenticação'
    };
    
    return statusMap[statusObj.status] || statusObj.status;
  };

  return (
    <div className="chatbot-page">
      <h1>Chatbot WhatsApp</h1>

      <div className="chatbot-controls">
        <div className="status-card">
          <h2>Status da Conexão</h2>
          <p className="status-text">{formatStatus(status)}</p>
          {status?.hasQRString && (
            <p style={{ fontSize: '12px', color: '#10b981', marginTop: '4px', fontWeight: '600' }}>
              ✅ QR Code disponível
            </p>
          )}
          {debugInfo && (
            <p style={{ fontSize: '11px', color: '#6b7280', marginTop: '8px', fontFamily: 'monospace' }}>
              🔍 Observação: {debugInfo}
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
                title="Pausa o bot globalmente - todas as mensagens serão ignoradas"
              >
                ⏸️ Pausar Bot
              </button>
              <button 
                onClick={handleRetomar} 
                disabled={loading || !status?.paused}
                className="btn btn-success"
                title="Retoma o bot - volta a responder automaticamente"
              >
                ▶️ Retomar Bot
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
            <h3>📱 Escaneie o QR Code com o WhatsApp</h3>
            <div className="qr-code-wrapper" style={{ 
              border: '3px solid #10b981',
              padding: '20px',
              borderRadius: '12px',
              backgroundColor: '#ffffff',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              margin: '20px 0',
              boxShadow: '0 4px 12px rgba(16, 185, 129, 0.2)'
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
            <p className="qr-instruction" style={{ marginTop: '16px', fontSize: '14px', maxWidth: '400px' }}>
              <strong>Como escanear:</strong><br/>
              1. Abra o WhatsApp no celular<br/>
              2. Toque em Menu (⋮) → <strong>Dispositivos conectados</strong><br/>
              3. Toque em <strong>Conectar dispositivo</strong><br/>
              4. Aponte a câmera para o QR Code acima
            </p>
            {/* QR code atualiza automaticamente a cada 15s */}
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
              {/* Removido botão manual; atualização é automática */}
            </div>
          </div>
        )}
      </div>

      <div className="appointments-card" style={{ marginTop: '24px' }}>
        <h2>📅 Agendamentos</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 13, color: '#374151' }}>Filtrar por data:</label>
          <input
            type="date"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
            className="btn"
            style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, background: '#fff' }}
          />
        </div>
        {loadingAppointments ? (
          <p>Carregando agendamentos...</p>
        ) : (() => {
          let visible = appointments.slice();
          const now = Date.now();
          visible = visible
            .filter(a => new Date(a.data || a.start_time).getTime() >= now)
            .sort((a, b) => new Date(a.data || a.start_time) - new Date(b.data || b.start_time));

          if (visible.length === 0) {
            return <p>Nenhum agendamento encontrado.</p>;
          }

          return (
            <div className="appointments-list" style={{ marginTop: '12px' }}>
              {visible.map(item => {
                const rawTipo = item.tipo || (item.agenda_type === 'online' ? 'reuniao' : 'visita');
                const tipo = ['online', 'reuniao'].includes(String(rawTipo).toLowerCase()) ? 'reuniao' : 'visita';
                const cliente = item.cliente_nome || item.client_name || '';
                const start = new Date(item.data || item.start_time);
                const end = new Date(item.fim || item.end_time || (start.getTime() + 60 * 60000));
                const titulo = `${tipo === 'reuniao' ? 'Atendimento - Reunião Online' : 'Atendimento - Visita'}${cliente ? ' | ' + cliente : ''}`;
                const dataStr = `${start.toLocaleDateString('pt-BR')}, ${start.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} — ${end.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
                const local = item.local || (tipo === 'reuniao' ? 'Online' : 'Av. Almirante Barroso, 389, Centro – João Pessoa – PB');
                const tipoLabel = tipo === 'reuniao' ? 'reunião online' : 'visita';
                return (
                  <div key={item.id} className="appointment-item" style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 14px',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    marginBottom: '10px',
                    background: '#fff'
                  }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 15 }}>{titulo}</div>
                      <div style={{ fontSize: '13px', color: '#374151' }}>{dataStr}</div>
                      <div style={{ fontSize: '12px', color: '#6b7280' }}>{`Tipo: ${tipoLabel} | Local: ${local}`}</div>
                    </div>
                    <div>
                      <button className="btn btn-secondary" style={{ marginRight: 8 }} onClick={() => handleUpdateAppointment(item.id, item)}>✏️ Alterar</button>
                      <button className="btn btn-danger" onClick={() => handleDeleteAppointment(item.id)}>🗑️ Cancelar</button>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>

      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

export default Chatbot;