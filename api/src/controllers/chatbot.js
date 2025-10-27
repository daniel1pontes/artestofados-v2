const whatsappService = require('../services/whatsapp');

const chatbotController = {
  async conectar(req, res) {
    try {
      console.log('\n' + '='.repeat(60));
      console.log('🚀 CONNECT ENDPOINT CALLED');
      console.log('='.repeat(60));
      
      // Iniciar conexão em background
      whatsappService.connect().catch(err => {
        console.error('❌ Error during background initialization:', err);
      });
      
      // Aguardar um pouco para inicialização começar
      console.log('⏳ Waiting for initialization...');
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Retornar resposta imediata (polling vai buscar o QR depois)
      res.json({ 
        message: 'WhatsApp client initializing... Please check QR code via /chatbot/qrcode endpoint',
        status: whatsappService.getStatus(),
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('❌ Error connecting WhatsApp:', error);
      res.status(500).json({ 
        error: 'Failed to connect to WhatsApp',
        details: error.message
      });
    }
  },

  async desconectar(req, res) {
    try {
      console.log('🔌 Disconnect requested');
      await whatsappService.disconnect();
      res.json({ message: 'WhatsApp disconnected successfully' });
    } catch (error) {
      console.error('❌ Error disconnecting WhatsApp:', error);
      res.status(500).json({ error: 'Failed to disconnect WhatsApp' });
    }
  },

  async pausar(req, res) {
    try {
      const { hours = 2 } = req.body;
      console.log(`⏸️ General pause requested for ${hours} hours`);
      whatsappService.pauseBot(hours);
      res.json({ 
        message: `Bot paused globally for ${hours} hours`,
        status: whatsappService.getStatus(),
      });
    } catch (error) {
      console.error('❌ Error pausing bot:', error);
      res.status(500).json({ error: 'Failed to pause bot' });
    }
  },

  async retomar(req, res) {
    try {
      console.log('▶️ Resume requested');
      whatsappService.resumeBot();
      res.json({ 
        message: 'Bot resumed',
        status: whatsappService.getStatus(),
      });
    } catch (error) {
      console.error('❌ Error resuming bot:', error);
      res.status(500).json({ error: 'Failed to resume bot' });
    }
  },

  async atendimentos(req, res) {
    try {
      const SessaoChatbot = require('../models/sessaoChatbot');
      const atendimentos = await SessaoChatbot.getAll();
      
      const formatted = atendimentos.map(session => ({
        id: session.id,
        phoneNumber: session.phone_number,
        state: session.state,
        metadata: session.metadata,
        createdAt: session.created_at,
        updatedAt: session.updated_at,
      }));

      res.json({ atendimentos: formatted });
    } catch (error) {
      console.error('❌ Error fetching atendimentos:', error);
      res.status(500).json({ error: 'Failed to fetch atendimentos' });
    }
  },

  async status(req, res) {
    try {
      const status = whatsappService.getStatus();
      const qrString = whatsappService.getQRString();
      
      console.log('📊 Status endpoint called:', {
        ...status,
        hasQRString: !!qrString,
        qrLength: qrString?.length || 0
      });
      
      res.json({ 
        ...status,
        hasQRString: !!qrString,
        qrStringLength: qrString?.length || 0,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('❌ Error getting status:', error);
      res.status(500).json({ error: 'Failed to get status' });
    }
  },

  async qrCode(req, res) {
    try {
      const qrString = whatsappService.getQRString();
      const status = whatsappService.getStatus();
      
      console.log('📱 QR Code endpoint called:', {
        hasQRString: !!qrString,
        qrLength: qrString?.length || 0,
        status: status.status,
        isBase64: qrString?.startsWith('data:image') || false
      });
      
      if (!qrString) {
        return res.json({ 
          qrCode: null,
          message: 'QR code not yet generated. Please wait a few more seconds.',
          status: status.status,
          timestamp: new Date().toISOString()
        });
      }
      
      res.json({ 
        qrCode: qrString,  // Retorna a imagem Base64
        status: status.status,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('❌ Error getting QR code:', error);
      res.status(500).json({ error: 'Failed to get QR code' });
    }
  },
};

module.exports = chatbotController;