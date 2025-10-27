import React, { useState } from 'react';
import { osAPI } from '../services/api';
import './GerarOS.css';

function GerarOS() {
  const [formData, setFormData] = useState({
    clientName: '',
    deadline: '',
    payment: '',
    items: [
      { description: '', quantity: '', unitValue: '', total: '' }
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

    if (field === 'quantity' || field === 'unitValue') {
      const qty = parseFloat(items[index].quantity) || 0;
      const unitVal = parseFloat(items[index].unitValue) || 0;
      items[index].total = (qty * unitVal).toFixed(2);
    }

    setFormData(prev => ({ ...prev, items }));
  };

  const addItem = () => {
    setFormData(prev => ({
      ...prev,
      items: [...prev.items, { description: '', quantity: '', unitValue: '', total: '' }]
    }));
  };

  const removeItem = (index) => {
    const items = formData.items.filter((_, i) => i !== index);
    setFormData(prev => ({ ...prev, items }));
  };

  const handleImageChange = (e) => {
    const files = Array.from(e.target.files);
    // In a real implementation, you would upload these to the server
    setFormData(prev => ({
      ...prev,
      images: [...prev.images, ...files.map(f => f.name)]
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setSuccess(false);

    try {
      const response = await osAPI.criar(formData);
      console.log('OS created:', response);
      setSuccess(true);
      setTimeout(() => {
        resetForm();
      }, 3000);
    } catch (error) {
      console.error('Error creating OS:', error);
      alert('Erro ao criar OS: ' + (error.response?.data?.error || error.message));
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      clientName: '',
      deadline: '',
      payment: '',
      items: [{ description: '', quantity: '', unitValue: '', total: '' }],
      discount: '',
      images: [],
    });
    setSuccess(false);
  };

  const calculateTotal = () => {
    const subtotal = formData.items.reduce((sum, item) => sum + parseFloat(item.total || 0), 0);
    const discount = parseFloat(formData.discount || 0);
    return (subtotal - discount).toFixed(2);
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
              <label>Prazo *</label>
              <input
                type="text"
                name="deadline"
                value={formData.deadline}
                onChange={handleChange}
                placeholder="Ex: 30 dias"
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
                placeholder="Ex: Dinheiro, PIX, etc"
                required
              />
            </div>
          </div>
        </div>

        <div className="form-section">
          <h2>Itens</h2>
          {formData.items.map((item, index) => (
            <div key={index} className="item-row">
              <div className="form-group full-width">
                <label>Descrição *</label>
                <input
                  type="text"
                  value={item.description}
                  onChange={(e) => handleItemChange(index, 'description', e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label>Quantidade *</label>
                <input
                  type="number"
                  step="0.01"
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
                  value={item.unitValue}
                  onChange={(e) => handleItemChange(index, 'unitValue', e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label>Total</label>
                <input
                  type="text"
                  value={`R$ ${item.total || '0.00'}`}
                  disabled
                />
              </div>
              {formData.items.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeItem(index)}
                  className="btn-remove"
                >
                  ❌
                </button>
              )}
            </div>
          ))}
          <button type="button" onClick={addItem} className="btn-add">
            + Adicionar Item
          </button>
        </div>

        <div className="form-section">
          <h2>Desconto</h2>
          <div className="form-group">
            <input
              type="number"
              step="0.01"
              name="discount"
              value={formData.discount}
              onChange={handleChange}
              placeholder="0.00"
            />
          </div>
        </div>

        <div className="form-section">
          <h2>Total: R$ {calculateTotal()}</h2>
        </div>

        <div className="form-section">
          <h2>Imagens</h2>
          <div className="form-group">
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
                  📷 {img}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="form-actions">
          <button type="submit" disabled={loading} className="btn-submit">
            {loading ? 'Gerando...' : 'Gerar OS'}
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

