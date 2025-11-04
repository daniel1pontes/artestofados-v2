import axios from 'axios';

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || '',
  timeout: 30000,
});

// Chatbot API
export const chatbotAPI = {
  conectar: async () => {
    const response = await api.post('/chatbot/conectar');
    return response.data;
  },

  desconectar: async () => {
    const response = await api.post('/chatbot/desconectar');
    return response.data;
  },

  pausar: async (hours = 2) => {
    const response = await api.post('/chatbot/pausar', { hours });
    return response.data;
  },

  pausarChat: async (phoneNumber, hours = 2) => {
    const response = await api.post('/chatbot/pausar-chat', { phoneNumber, hours });
    return response.data;
  },

  retomarChat: async (phoneNumber) => {
    const response = await api.post('/chatbot/retomar-chat', { phoneNumber });
    return response.data;
  },

  retomar: async () => {
    const response = await api.post('/chatbot/retomar');
    return response.data;
  },

  getStatus: async () => {
    const response = await api.get('/chatbot/status');
    return response.data;
  },

  getQRCode: async () => {
    const response = await api.get('/chatbot/qrcode');
    return response.data;
  },
};

// OS API
export const osAPI = {
  criar: async (data) => {
    const response = await api.post('/os/criar', data);
    return response.data;
  },

  listar: async (search = '') => {
    const response = await api.get('/os', { params: { search } });
    return response.data;
  },

  obter: async (id) => {
    const response = await api.get(`/os/${id}`);
    return response.data;
  },

  download: async (id) => {
    const response = await api.get(`/os/${id}/download`, {
      responseType: 'blob',
    });
    return response.data;
  },

  atualizar: async (id, data) => {
    const response = await api.put(`/os/${id}`, data);
    return response.data;
  },

  deletar: async (id) => {
    const response = await api.delete(`/os/${id}`);
    return response.data;
  },
};

// Appointments API
export const appointmentsAPI = {
  listar: async () => {
    const response = await api.get('/api/appointments');
    return response.data;
  },
  atualizar: async (id, data) => {
    const response = await api.patch(`/api/appointments/${id}`, data);
    return response.data;
  },
  deletar: async (id) => {
    const response = await api.delete(`/api/appointments/${id}`);
    return response.data;
  },
};

// Agendamentos API (mapeado conforme especificação)
export const agendamentosAPI = {
  listar: async (params = {}) => {
    const response = await api.get('/api/agendamentos', { params });
    return response.data;
  },
};

export default api;