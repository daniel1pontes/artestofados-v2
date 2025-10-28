import React, { useState } from 'react';
import { osAPI } from '../services/api';
import './GerarOS.css';

// 📝 OBSERVAÇÕES IMPORTANTES:
// 1. Este código mantém EXATAMENTE a mesma estrutura de cálculo do desktop antigo
// 2. Desconto por item é aplicado PRIMEIRO
// 3. Desconto geral é aplicado DEPOIS no subtotal
// 4. O PDF será gerado com a mesma formatação da versão antiga

function GerarOS() {
  const [formData, setFormData] = useState({
    clientName: '',
    deadline: '',
    payment: '',
    items: [
      { description: '', quantity: '', unitValue: '', discount: 0, total: '' }
    ],
    discount: '',
    images: [],
  });

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleItemChange = (index, field, value) => {
    const items = [...formData.items];
    items[index][field] = value;

    // Recalcular total quando mudar quantidade, valor unitário ou desconto do item
    if (field === 'quantity' || field === 'unitValue' || field === 'discount') {
      const qty = parseFloat(items[index].quantity) || 0;
      const unitVal = parseFloat(items[index].unitValue) || 0;
      const itemDiscount = parseFloat(items[index].discount) || 0;
      
      // Calcular subtotal do item
      let subtotal = qty * unitVal;
      
      // Aplicar desconto do item
      let totalItem = subtotal - (subtotal * itemDiscount / 100);
      
      items[index].total = totalItem.toFixed(2);
    }

    setFormData(prev => ({ ...prev, items }));
  };

  const addItem = () => {
    setFormData(prev => ({
      ...prev,
      items: [...prev.items, { description: '', quantity: '', unitValue: '', discount: 0, total: '' }]
    }));
  };

  const removeItem = (index) => {
    const items = formData.items.filter((_, i) => i !== index);
    setFormData(prev => ({ ...prev, items }));
  };

  const handleImageChange = (e) => {
    const files = Array.from(e.target.files);
    setFormData(prev => ({
      ...prev,
      images: [...prev.images, ...files]
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setSuccess(false);

    try {
      // Create FormData for file upload
      const formDataToSend = new FormData();
      formDataToSend.append('clientName', formData.clientName);
      formDataToSend.append('deadline', formData.deadline);
      formDataToSend.append('payment', formData.payment);
      formDataToSend.append('items', JSON.stringify(formData.items));
      formDataToSend.append('discount', formData.discount || 0);
      
      // Add images
      formData.images.forEach((image, index) => {
        formDataToSend.append('images', image);
      });

      const response = await fetch('http://localhost:3000/os/criar', {
        method: 'POST',
        body: formDataToSend,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Erro ao criar OS');
      }

      const result = await response.json();
      console.log('✅ OS created:', result);
      setSuccess(true);
      
      alert(`✅ OS gerada com sucesso!\n\nCliente: ${formData.clientName}\nTotal: ${calculateTotal()}`);
      
      setTimeout(() => {
        resetForm();
      }, 3000);
    } catch (error) {
      console.error('❌ Error creating OS:', error);
      alert('Erro ao criar OS: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      clientName: '',
      deadline: '',
      payment: '',
      items: [{ description: '', quantity: '', unitValue: '', discount: 0, total: '' }],
      discount: '',
      images: [],
    });
    setSuccess(false);
  };

  const calculateTotal = () => {
    // Calcular subtotal dos itens (já com desconto por item aplicado)
    const subtotal = formData.items.reduce((sum, item) => sum + parseFloat(item.total || 0), 0);
    
    // Aplicar desconto geral
    const generalDiscount = parseFloat(formData.discount || 0);
    const discountAmount = (subtotal * generalDiscount) / 100;
    const total = subtotal - discountAmount;
    
    return total.toFixed(2);
  };

  const calculateSubtotal = () => {
    const subtotal = formData.items.reduce((sum, item) => sum + parseFloat(item.total || 0), 0);
    return subtotal.toFixed(2);
  };

  const calculateGeneralDiscount = () => {
    const subtotal = parseFloat(calculateSubtotal());
    const generalDiscount = parseFloat(formData.discount || 0);
    const discountAmount = (subtotal * generalDiscount) / 100;
    return discountAmount.toFixed(2);
  };

  return (
    <div className="gerar-os-page">
      <h1>📝 Gerar OS</h1>

      <form onSubmit={handleSubmit} className="os-form">
        <div className="form-section">
          <h2>Informações do Cliente</h2>
          <div className="form-row">
            <div className="form-group">
              <label>Nome do Cliente *</label>
              <input
                type="text"
                name="clientName"
                value={formData.clientName}
                onChange={handleChange}
                required
              />
            </div>
            <div className="form-group">
              <label>Prazo de Entrega *</label>
              <input
                type="date"
                name="deadline"
                value={formData.deadline}
                onChange={handleChange}
                required
              />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Forma de Pagamento *</label>
              <input
                type="text"
                name="payment"
                value={formData.payment}
                onChange={handleChange}
                placeholder="Ex: Dinheiro, PIX, Cartão, etc"
                required
              />
            </div>
          </div>
        </div>

        <div className="form-section">
          <h2>Itens da OS</h2>
          {formData.items.map((item, index) => (
            <div key={index} className="item-row" style={{
              gridTemplateColumns: '3fr 1fr 1.2fr 1fr 1.2fr auto',
              gap: '12px'
            }}>
              <div className="form-group">
                <label>Descrição *</label>
                <input
                  type="text"
                  value={item.description}
                  onChange={(e) => handleItemChange(index, 'description', e.target.value)}
                  placeholder="Ex: Sofá 3 lugares"
                  required
                />
              </div>
              <div className="form-group">
                <label>Qtd *</label>
                <input
                  type="number"
                  step="1"
                  min="1"
                  value={item.quantity}
                  onChange={(e) => handleItemChange(index, 'quantity', e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label>Valor Unit. *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={item.unitValue}
                  onChange={(e) => handleItemChange(index, 'unitValue', e.target.value)}
                  placeholder="0.00"
                  required
                />
              </div>
              <div className="form-group">
                <label>Desc. Item (%)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={item.discount}
                  onChange={(e) => handleItemChange(index, 'discount', e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="form-group">
                <label>Total Item</label>
                <input
                  type="text"
                  value={item.total ? `R$ ${parseFloat(item.total).toFixed(2)}` : 'R$ 0.00'}
                  disabled
                  style={{ backgroundColor: '#f0f0f0', fontWeight: '600' }}
                />
              </div>
              {formData.items.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeItem(index)}
                  className="btn-remove"
                  style={{ marginTop: '24px' }}
                >
                  ❌
                </button>
              )}
            </div>
          ))}
          <button type="button" onClick={addItem} className="btn-add">
            ➕ Adicionar Item
          </button>
        </div>

        <div className="form-section">
          <h2>Desconto Geral da Nota</h2>
          <div className="form-row">
            <div className="form-group">
              <label>Desconto Geral (%)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                max="100"
                name="discount"
                value={formData.discount}
                onChange={handleChange}
                placeholder="0"
              />
            </div>
          </div>
        </div>

        <div className="form-section" style={{
          backgroundColor: '#f8f9fa',
          padding: '20px',
          borderRadius: '8px',
          border: '2px solid #e5e7eb'
        }}>
          <h2 style={{ marginBottom: '12px' }}>💰 Resumo Financeiro</h2>
          <div style={{ fontSize: '16px', lineHeight: '2' }}>
            <p><strong>Subtotal dos Itens:</strong> <span style={{ float: 'right', color: '#666' }}>R$ {calculateSubtotal()}</span></p>
            {formData.discount && parseFloat(formData.discount) > 0 && (
              <p><strong>Desconto Geral ({formData.discount}%):</strong> <span style={{ float: 'right', color: '#dc3545' }}>- R$ {calculateGeneralDiscount()}</span></p>
            )}
            <hr style={{ margin: '10px 0', border: 'none', borderTop: '2px solid #dee2e6' }} />
            <p style={{ fontSize: '20px', color: '#28a745', fontWeight: '700' }}>
              <strong>TOTAL DA OS:</strong> 
              <span style={{ float: 'right' }}>R$ {calculateTotal()}</span>
            </p>
          </div>
        </div>

        <div className="form-section">
          <h2>📷 Imagens (Opcional)</h2>
          <div className="form-group">
            <label>Selecionar Imagens</label>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageChange}
            />
          </div>
          {formData.images.length > 0 && (
            <div className="image-list">
              {formData.images.map((img, index) => (
                <div key={index} className="image-item">
                  📷 {img.name || img}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="form-actions">
          <button type="submit" disabled={loading} className="btn-submit">
            {loading ? '⏳ Gerando OS...' : '✅ Gerar OS'}
          </button>
          {success && (
            <div className="success-message">
              ✅ OS gerada com sucesso!
            </div>
          )}
        </div>
      </form>
    </div>
  );
}

export default GerarOS;