import React, { useState, useEffect } from 'react';
import { osAPI } from '../services/api';
import './BancoOS.css';

function BancoOS() {
  const [osList, setOsList] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedOS, setSelectedOS] = useState(null);

  const formatDateBR = (d) => {
    if (!d) return '';
    const s = String(d);
    // Caso mais comum: 'YYYY-MM-DD' (evitar new Date para não aplicar UTC e perder 1 dia)
    const isoShort = /^\d{4}-\d{2}-\d{2}$/;
    if (isoShort.test(s)) {
      const [yyyy, mm, dd] = s.split('-');
      return `${dd}-${mm}-${yyyy}`;
    }
    try {
      // Outros formatos: tentar Date, mas isso pode aplicar timezone
      const date = new Date(s);
      if (isNaN(date.getTime())) {
        // Fallback genérico com separadores
        const parts = s.split(/[-/]/);
        if (parts.length >= 3) {
          const [y, m, day] = parts.length === 3 && parts[0].length === 4 ? parts : [parts[2], parts[1], parts[0]];
          const dd = String(day).padStart(2, '0');
          const mm = String(m).padStart(2, '0');
          const yyyy = String(y);
          return `${dd}-${mm}-${yyyy}`;
        }
        return s;
      }
      const dd = String(date.getDate()).padStart(2, '0');
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const yyyy = date.getFullYear();
      return `${dd}-${mm}-${yyyy}`;
    } catch {
      return s;
    }
  };

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
      if (!os.pdfPath) {
        alert('PDF não disponível para esta OS');
        return;
      }
      
      const data = await osAPI.obter(os.id);
      setSelectedOS({
        ...data.os,
        showPDF: true
      });
    } catch (error) {
      console.error('Error loading OS details:', error);
      alert('Erro ao carregar detalhes da OS: ' + error.message);
    }
  };

  const handleDelete = async (os) => {
    if (!window.confirm(`Tem certeza que deseja excluir a OS #${os.id} do cliente ${os.clientName}?`)) {
      return;
    }

    try {
      await osAPI.deletar(os.id);
      alert('OS excluída com sucesso!');
      loadOS(); // Recarregar a lista
    } catch (error) {
      console.error('Error deleting OS:', error);
      alert('Erro ao excluir OS: ' + error.message);
    }
  };

  const closeModal = () => {
    setSelectedOS(null);
  };

  return (
    <div className="banco-os-page">
      <h1>Banco de OS</h1>

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
                <th>Pagamento</th>
                <th>Valor Total da OS</th>
                <th>Prazo de Entrega</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {osList.map(os => {
                // Calcular valor total da OS
                const items = typeof os.items === 'string' ? JSON.parse(os.items) : os.items || [];
                const subtotal = items.reduce((sum, item) => sum + parseFloat(item.total || 0), 0);
                const discount = parseFloat(os.discount || 0);
                const total = subtotal - discount;
                
                return (
                  <tr key={os.id}>
                    <td>{os.id}</td>
                    <td>{os.clientName}</td>
                    <td>{os.payment}</td>
                    <td>R$ {total.toFixed(2)}</td>
                    <td>{formatDateBR(os.deadline)}</td>
                    <td>
                      <div className="action-buttons">
                        <button onClick={() => handleView(os)} className="btn-view">
                          👁️ Ver
                        </button>
                        {os.pdfPath ? (
                          <button onClick={() => handleDownload(os)} className="btn-download">
                            📥 Baixar PDF
                          </button>
                        ) : (
                          <span className="no-pdf">PDF não disponível</span>
                        )}
                        <button onClick={() => handleDelete(os)} className="btn-delete">
                          🗑️ Excluir
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selectedOS && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className={`modal-content ${selectedOS.showPDF ? 'pdf-modal' : ''}`} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>OS #{selectedOS.id}</h2>
              <div className="modal-actions">
                {selectedOS.showPDF && (
                  <button onClick={() => setSelectedOS({...selectedOS, showPDF: false})} className="btn-details">
                    📋 Detalhes
                  </button>
                )}
                <button onClick={closeModal} className="btn-close">×</button>
              </div>
            </div>
            
            {selectedOS.showPDF ? (
              <div className="pdf-viewer">
                <iframe
                  src={`http://localhost:3000/uploads/${selectedOS.pdfPath}`}
                  width="100%"
                  height="600px"
                  style={{ border: 'none' }}
                  title={`OS ${selectedOS.id} PDF`}
                  onError={() => {
                    console.error('Erro ao carregar PDF no iframe');
                  }}
                />
                <div className="pdf-fallback" style={{ display: 'none' }}>
                  <div className="pdf-error">
                    <h3>📄 PDF não pode ser exibido no navegador</h3>
                    <p>Clique no botão abaixo para baixar o PDF:</p>
                    <button 
                      onClick={() => handleDownload(selectedOS)} 
                      className="btn-download-pdf"
                    >
                      📥 Baixar PDF
                    </button>
                  </div>
                </div>
              </div>
            ) : (
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
                      <p>Quantidade: {item.quantity}</p>
                      <p>Valor Unitário: R$ {parseFloat(item.unitValue).toFixed(2)}</p>
                      {item.discount > 0 && (
                        <p>Desconto Item: {item.discount}%</p>
                      )}
                      <p><strong>Total: R$ {parseFloat(item.total).toFixed(2)}</strong></p>
                    </div>
                  ))}
                </div>
                
                {/* Exibir imagens se existirem */}
                {selectedOS.images && selectedOS.images.length > 0 && (
                  <div className="os-images">
                    <h3>Imagens</h3>
                    <div className="images-grid">
                      {(typeof selectedOS.images === 'string' ? JSON.parse(selectedOS.images) : selectedOS.images).map((imageName, index) => (
                        <div key={index} className="image-item">
                          <img 
                            src={`http://localhost:3000/uploads/${imageName}`}
                            alt={`Imagem ${index + 1}`}
                            className="os-image"
                            onError={(e) => {
                              e.target.style.display = 'none';
                              e.target.nextSibling.style.display = 'block';
                            }}
                          />
                          <div className="image-error" style={{ display: 'none' }}>
                            📷 {imageName}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            
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