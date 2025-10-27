const whatsappService = require('../services/whatsapp');

const chatbotController = {
  async conectar(req, res) {
    try {
      console.log('Starting WhatsApp connection...');
      const client = whatsappService.initializeWhatsApp();
      
      // Initialize in background and return immediately
      client.initialize().then(() => {
        console.log('WhatsApp initialized successfully');
      }).catch(err => {
        console.error('Error initializing WhatsApp:', err);
      });
      
      // Wait a bit for QR code generation
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const qrCode = whatsappService.getQRCode();
      const status = whatsappService.getStatus();
      
      console.log('Connection attempt:', { hasQR: !!qrCode, status });
      
      res.json({ 
        message: 'WhatsApp client initializing...',
        qrCode: qrCode || null,
        status,
      });
    } catch (error) {
      console.error('Error connecting WhatsApp:', error);
      res.status(500).json({ 
        error: 'Failed to connect to WhatsApp',
        details: error.message 
      });
    }
  },

  async desconectar(req, res) {
    try {
      await whatsappService.disconnect();
      res.json({ message: 'WhatsApp disconnected successfully' });
    } catch (error) {
      console.error('Error disconnecting WhatsApp:', error);
      res.status(500).json({ error: 'Failed to disconnect WhatsApp' });
    }
  },

  async pausar(req, res) {
    try {
      const { hours = 2 } = req.body;
      whatsappService.pauseBot(hours);
      res.json({ 
        message: `Bot paused for ${hours} hours`,
        status: whatsappService.getStatus(),
      });
    } catch (error) {
      console.error('Error pausing bot:', error);
      res.status(500).json({ error: 'Failed to pause bot' });
    }
  },

  async retomar(req, res) {
    try {
      whatsappService.resumeBot();
      res.json({ 
        message: 'Bot resumed',
        status: whatsappService.getStatus(),
      });
    } catch (error) {
      console.error('Error resuming bot:', error);
      res.status(500).json({ error: 'Failed to resume bot' });
    }
  },

  async atendimentos(req, res) {
    try {
      const SessaoChatbot = require('../models/sessaoChatbot');
      const atendimentos = await SessaoChatbot.getAll();
      
      // Format data for response
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
      console.error('Error fetching atendimentos:', error);
      res.status(500).json({ error: 'Failed to fetch atendimentos' });
    }
  },

  async status(req, res) {
    try {
      const status = whatsappService.getStatus();
      res.json(status);
    } catch (error) {
      console.error('Error getting status:', error);
      res.status(500).json({ error: 'Failed to get status' });
    }
  },

  async qrCode(req, res) {
    try {
      const qrCode = whatsappService.getQRCode();
      console.log('QR Code requested, current QR:', qrCode ? 'exists' : 'not found');
      if (!qrCode) {
        return res.json({ qrCode: null, message: 'QR code not yet generated' });
      }
      res.json({ qrCode });
    } catch (error) {
      console.error('Error getting QR code:', error);
      res.status(500).json({ error: 'Failed to get QR code' });
    }
  },
};

module.exports = chatbotController;

