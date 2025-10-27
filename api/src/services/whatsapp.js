const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const pool = require('../config/database');

let client = null;
let qrCode = '';
let status = 'disconnected';
let pausedUntil = null;
let pendingMessage = null;

function initializeWhatsApp() {
  if (client) {
    return client;
  }

  // Clean up SingletonLock if it exists
  const fs = require('fs');
  const path = require('path');
  try {
    const lockFile = path.join(__dirname, '../../whatsapp-session/session/SingletonLock');
    if (fs.existsSync(lockFile)) {
      fs.unlinkSync(lockFile);
      console.log('Cleaned up SingletonLock');
    }
  } catch (err) {
    console.log('No lock file to clean');
  }

  // Use installed Chromium in Docker, or default for local development
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;

  client = new Client({
    authStrategy: new LocalAuth({
      dataPath: './whatsapp-session',
    }),
    puppeteer: {
      headless: true,
      executablePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-extensions',
        '--disable-sync',
        '--metrics-recording-only',
        '--mute-audio',
        '--no-first-run',
        '--safebrowsing-disable-auto-update',
        '--ignore-certificate-errors',
        '--ignore-ssl-errors',
        '--ignore-certificate-errors-spki-list',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ],
      ignoreHTTPSErrors: true,
    },
  });

  client.on('qr', async (qr) => {
    // Generate QR code as HTML
    try {
      qrCode = await QRCode.toString(qr, { 
        type: 'svg',
        errorCorrectionLevel: 'L'
      });
      console.log('QR Code generated as HTML');
    } catch (err) {
      console.error('Error generating QR code:', err);
      qrCode = qr;
    }
  });

  client.on('ready', () => {
    status = 'connected';
    console.log('WhatsApp client is ready!');
  });

  client.on('authenticated', () => {
    status = 'authenticating';
    console.log('Authenticated');
  });

  client.on('auth_failure', (msg) => {
    status = 'auth_failure';
    console.error('Authentication failed:', msg);
  });

  client.on('disconnected', (reason) => {
    status = 'disconnected';
    console.log('Client was disconnected:', reason);
  });

  client.on('message', async (msg) => {
    await handleIncomingMessage(msg);
  });

  return client;
}

async function handleIncomingMessage(msg) {
  try {
    const contact = await msg.getContact();
    const fromNumber = contact.id.user;
    
    // Check if message is from an employee (you may need to configure employee numbers)
    const isEmployee = await checkIfEmployee(fromNumber);
    
    if (isEmployee && status === 'connected') {
      // Pause bot for 2 hours when employee sends message
      pauseBot(2);
    }

    // Save message to database
    await saveMessage(msg.id._serialized, fromNumber, msg.body, msg.timestamp);

    // Process chatbot logic (if not paused)
    if (status === 'connected' && !isPaused()) {
      await processChatbotMessage(msg);
    }
  } catch (error) {
    console.error('Error handling incoming message:', error);
  }
}

async function checkIfEmployee(number) {
  // Implement your logic to check if number belongs to employee
  const employees = process.env.EMPLOYEE_NUMBERS?.split(',') || [];
  return employees.includes(number);
}

async function saveMessage(messageId, fromNumber, body, timestamp) {
  try {
    await pool.query(
      `INSERT INTO messages (id, from_number, body, timestamp, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [messageId, fromNumber, body, new Date(timestamp * 1000)]
    );
  } catch (error) {
    console.error('Error saving message:', error);
  }
}

async function processChatbotMessage(msg) {
  try {
    const contact = await msg.getContact();
    const fromNumber = contact.id.user;
    const sessionId = await getOrCreateSession(fromNumber);
    
    // Get or create conversation state
    const state = await getConversationState(sessionId);
    
    // Process based on state
    const response = await generateChatbotResponse(msg.body, state);
    
    if (response) {
      await sendMessage(fromNumber, response);
      await updateConversationState(sessionId, response);
    }
  } catch (error) {
    console.error('Error processing chatbot message:', error);
  }
}

async function getOrCreateSession(phoneNumber) {
  try {
    const result = await pool.query(
      `SELECT id FROM sessions WHERE phone_number = $1`,
      [phoneNumber]
    );

    if (result.rows.length > 0) {
      return result.rows[0].id;
    }

    const insertResult = await pool.query(
      `INSERT INTO sessions (phone_number, state, created_at)
       VALUES ($1, 'initial', NOW())
       RETURNING id`,
      [phoneNumber]
    );

    return insertResult.rows[0].id;
  } catch (error) {
    console.error('Error getting/creating session:', error);
    throw error;
  }
}

async function getConversationState(sessionId) {
  try {
    const result = await pool.query(
      `SELECT state, metadata FROM sessions WHERE id = $1`,
      [sessionId]
    );

    if (result.rows.length > 0) {
      return {
        state: result.rows[0].state,
        metadata: result.rows[0].metadata || {},
      };
    }

    return { state: 'initial', metadata: {} };
  } catch (error) {
    console.error('Error getting conversation state:', error);
    return { state: 'initial', metadata: {} };
  }
}

async function updateConversationState(sessionId, newState, metadata = {}) {
  try {
    await pool.query(
      `UPDATE sessions SET state = $1, metadata = $2, updated_at = NOW()
       WHERE id = $3`,
      [newState, JSON.stringify(metadata), sessionId]
    );
  } catch (error) {
    console.error('Error updating conversation state:', error);
  }
}

async function generateChatbotResponse(message, stateObj) {
  const openai = require('../config/openai');
  const { state, metadata } = stateObj;

  const systemPrompt = `You are a helpful assistant for a furniture company. Your role is to:
1. Welcome customers warmly
2. Classify their request as either "Fabricação" (Manufacturing) or "Reforma" (Reform)
3. Guide them through the process

For Reform: Request photos and inform that the team will respond
For Manufacturing: Suggest a 1-hour meeting or site visit

Keep responses concise and professional.`;

  const conversation = [
    { role: 'system', content: systemPrompt },
  ];

  // Add conversation history from metadata
  if (metadata.history) {
    conversation.push(...metadata.history);
  }

  conversation.push({ role: 'user', content: message });

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: conversation,
      temperature: 0.7,
    });

    const response = completion.choices[0].message.content;

    // Update metadata with conversation history
    if (!metadata.history) metadata.history = [];
    metadata.history.push(
      { role: 'user', content: message },
      { role: 'assistant', content: response }
    );

    // Determine next state based on response
    let nextState = state;
    if (state === 'initial') {
      nextState = 'classified';
    } else if (state === 'classified') {
      if (metadata.classification === 'Reforma') {
        nextState = 'waiting_photos';
      } else if (metadata.classification === 'Fabricação') {
        nextState = 'scheduling';
      }
    }

    return { response, nextState, metadata };
  } catch (error) {
    console.error('Error generating chatbot response:', error);
    return null;
  }
}

async function sendMessage(phoneNumber, response) {
  if (!client || status !== 'connected') {
    throw new Error('WhatsApp client not connected');
  }

  try {
    const chatId = phoneNumber.includes('@c.us') 
      ? phoneNumber 
      : `${phoneNumber}@c.us`;
    
    await client.sendMessage(chatId, response);
  } catch (error) {
    console.error('Error sending message:', error);
    throw error;
  }
}

function pauseBot(hours = 2) {
  pausedUntil = new Date(Date.now() + hours * 60 * 60 * 1000);
  console.log(`Bot paused until ${pausedUntil}`);
}

function resumeBot() {
  pausedUntil = null;
  console.log('Bot resumed');
}

function isPaused() {
  if (!pausedUntil) return false;
  
  if (Date.now() > pausedUntil.getTime()) {
    pausedUntil = null;
    return false;
  }

  return true;
}

function getQRCode() {
  return qrCode;
}

function getStatus() {
  return {
    status,
    paused: isPaused(),
    pausedUntil: pausedUntil?.toISOString(),
  };
}

module.exports = {
  initializeWhatsApp,
  connect: async () => {
    const cli = initializeWhatsApp();
    await cli.initialize();
  },
  disconnect: async () => {
    if (client) {
      await client.destroy();
      client = null;
      status = 'disconnected';
    }
  },
  pauseBot,
  resumeBot,
  getQRCode,
  getStatus,
  sendMessage,
};

