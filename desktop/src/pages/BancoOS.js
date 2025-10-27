import React, { useState, useEffect } from 'react';
import { osAPI } from '../services/api';
import './BancoOS.css';

function BancoOS() {
  const [osList, setOsList] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedOS, setSelectedOS] = useState(null);

  useEffect(() => {
    loadOS();
  }, []);

  const loadOS = async () => {
    setLoading(true);
    try {
      const data = await osAPI.listar(searchTerm);
      setOsList(data.osList || []);
    } catch (error) {
      console.error('Error loading OS:', error);
      alert('Erro ao carregar OS: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOS();
  }, [searchTerm]);

  const handleSearch = (e) => {
    setSearchTerm(e.target.value);
  };

  const handleDownload = async (os) => {
    try {
      const blob = await osAPI.download(os.id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `OS_${os.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading OS:', error);
      alert('Erro ao baixar OS: ' + error.message);
    }
  };

  const handleView = async (os) => {
    try {
      const data = await osAPI.obter(os.id);
      setSelectedOS(data.os);
    } catch (error) {
      console.error('Error loading OS details:', error);
      alert('Erro ao carregar detalhes da OS: ' + error.message);
    }
  };

  const closeModal = () => {
    setSelectedOS(null);
  };

  return (
    <div className="banco-os-page">
      <h1>📦 Banco de OS</h1>

      <div className="search-section">
        <input
          type="text"
          placeholder="Pesquisar por nome do cliente ou número da OS..."
          value={searchTerm}
          onChange={handleSearch}
          className="search-input"
        />
      </div>

      {loading ? (
        <div className="loading">Carregando...</div>
      ) : osList.length === 0 ? (
        <div className="empty-state">
          <p>Nenhuma OS encontrada</p>
        </div>
      ) : (
        <div className="os-table">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Cliente</th>
                <th>Prazo</th>
                <th>Pagamento</th>
                <th>Data</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {osList.map(os => (
                <tr key={os.id}>
                  <td>{os.id}</td>
                  <td>{os.clientName}</td>
                  <td>{os.deadline}</td>
                  <td>{os.payment}</td>
                  <td>{new Date(os.createdAt).toLocaleDateString('pt-BR')}</td>
                  <td>
                    <button onClick={() => handleView(os)} className="btn-view">
                      👁️ Ver
                    </button>
                    {os.pdfPath && (
                      <button onClick={() => handleDownload(os)} className="btn-download">
                        📥 Baixar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedOS && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>OS #{selectedOS.id}</h2>
              <button onClick={closeModal} className="btn-close">×</button>
            </div>
            <div className="modal-body">
              <div className="os-detail">
                <p><strong>Cliente:</strong> {selectedOS.clientName}</p>
                <p><strong>Prazo:</strong> {selectedOS.deadline}</p>
                <p><strong>Pagamento:</strong> {selectedOS.payment}</p>
                <p><strong>Desconto:</strong> R$ {parseFloat(selectedOS.discount || 0).toFixed(2)}</p>
                <p><strong>Data:</strong> {new Date(selectedOS.createdAt).toLocaleString('pt-BR')}</p>
              </div>
              <div className="os-items">
                <h3>Itens</h3>
                {(typeof selectedOS.items === 'string' ? JSON.parse(selectedOS.items) : selectedOS.items || []).map((item, index) => (
                  <div key={index} className="item-detail">
                    <p><strong>{item.description}</strong></p>
                    <p>{item.quantity} x R$ {parseFloat(item.unitValue).toFixed(2)} = R$ {parseFloat(item.total).toFixed(2)}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={closeModal} className="btn-close-modal">
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default BancoOS;

