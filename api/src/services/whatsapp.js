const { Client, LocalAuth } = require('whatsapp-web.js');
const pool = require('../config/database');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

let client = null;
let qrString = '';
let status = 'disconnected';
let pausedUntil = null;
let initializationAttempt = 0;
let chatPauses = new Map();

// LIMPAR COMPLETAMENTE A SESSÃO E LOCKS
function cleanupSession() {
  console.log('🧹 Cleaning up session and locks...');
  
  try {
    const lockFile = path.join(__dirname, '../../whatsapp-session/session/SingletonLock');
    if (fs.existsSync(lockFile)) {
      fs.unlinkSync(lockFile);
      console.log('✅ Removed SingletonLock');
    }
    
    const lockPatterns = ['SingletonCookie', 'SingletonSocket', 'Singleton'];
    const sessionDir = path.join(__dirname, '../../whatsapp-session/session');
    
    if (fs.existsSync(sessionDir)) {
      const files = fs.readdirSync(sessionDir);
      files.forEach(file => {
        if (lockPatterns.some(pattern => file.includes(pattern))) {
          const filePath = path.join(sessionDir, file);
          try {
            fs.unlinkSync(filePath);
            console.log(`✅ Removed ${file}`);
          } catch (err) {
            console.log(`⚠️ Could not remove ${file}:`, err.message);
          }
        }
      });
    }
    
    console.log('✅ Session cleanup complete');
  } catch (err) {
    console.log('⚠️ Cleanup error (non-critical):', err.message);
  }
}

// MATAR PROCESSOS ANTIGOS DO CHROME
function killOldChromeProcesses() {
  return new Promise((resolve) => {
    console.log('🔪 Checking for old Chrome processes...');
    
    exec('pkill -9 chrome', (error, stdout, stderr) => {
      if (error) {
        console.log('ℹ️ No old Chrome processes found (or pkill not available)');
      } else {
        console.log('✅ Killed old Chrome processes');
      }
      resolve();
    });
  });
}

async function initializeWhatsApp(forceNew = false) {
  if (client && !forceNew) {
    console.log('⚠️ Client already exists');
    if (client.pupBrowser) {
      console.log('ℹ️ Browser is still running, returning existing client');
      return client;
    } else {
      console.log('⚠️ Client exists but browser died, will create new one');
      client = null;
    }
  }

  initializationAttempt++;
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🚀 Initializing WhatsApp client (Attempt #${initializationAttempt})...`);
  console.log('='.repeat(80));

  await killOldChromeProcesses();
  cleanupSession();
  await new Promise(resolve => setTimeout(resolve, 2000));

  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser';
  console.log('🔧 Puppeteer executable path:', executablePath);

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
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-blink-features=AutomationControlled',
        '--disable-web-security',
        '--user-data-dir=/tmp/puppeteer-user-data-' + Math.random().toString(36),
        '--disable-software-rasterizer',
        '--disable-extensions-file-access-check',
        '--disable-extensions-http-throttling',
      ],
      ignoreHTTPSErrors: true,
      timeout: 60000,
    },
  });

  client.on('qr', async (qr) => {
    if (status === 'connected') {
      console.log('⚠️ QR code event received but already connected, ignoring');
      return;
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('🎯 QR CODE EVENT TRIGGERED!');
    console.log('='.repeat(80));
    
    try {
      const QRCode = require('qrcode');
      const qrBase64 = await QRCode.toDataURL(qr, {
        width: 300,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });
      
      qrString = qrBase64;
      status = 'qr_ready';
      
      console.log('✅ QR Code converted to Base64 PNG');
      console.log('📏 Base64 length:', qrBase64.length);
      console.log('='.repeat(80));
      
      try {
        const qrcodeTerminal = require('qrcode-terminal');
        console.log('\n📱 QR CODE NO TERMINAL:\n');
        qrcodeTerminal.generate(qr, { small: true });
        console.log('\n');
      } catch (err) {
        console.log('⚠️ qrcode-terminal not available');
      }
    } catch (err) {
      console.error('❌ Error converting QR to Base64:', err);
      qrString = qr;
      status = 'qr_ready';
    }
  });

  client.on('loading_screen', (percent, message) => {
    console.log(`📱 Loading: ${percent}% - ${message}`);
  });

  client.on('ready', () => {
    status = 'connected';
    qrString = '';
    initializationAttempt = 0;
    console.log('\n' + '='.repeat(80));
    console.log('✅ WhatsApp client CONNECTED and READY!');
    console.log('='.repeat(80) + '\n');
  });

  client.on('authenticated', () => {
    status = 'authenticated';
    console.log('🔐 Authentication successful');
  });

  client.on('auth_failure', (msg) => {
    status = 'auth_failure';
    qrString = '';
    console.error('❌ Authentication failed:', msg);
    console.log('💡 Tip: Delete whatsapp-session folder and try again');
  });

  client.on('disconnected', (reason) => {
    status = 'disconnected';
    qrString = '';
    console.log('🔌 Client disconnected:', reason);
    cleanupSession();
    client = null;
  });

  client.on('message', async (msg) => {
    await handleIncomingMessage(msg);
  });

  console.log('⏳ Client created, waiting for initialization...');
  return client;
}

async function handleIncomingMessage(msg) {
  try {
    console.log('\n' + '='.repeat(80));
    console.log('📩 NEW MESSAGE RECEIVED');
    console.log('='.repeat(80));
    
    const contact = await msg.getContact();
    const fromNumber = contact.id.user;
    
    console.log('📞 From:', fromNumber);
    console.log('💬 Message:', msg.body);
    console.log('🆔 Message ID:', msg.id._serialized);
    
    // Verificar se é funcionário
    const isEmployee = await checkIfEmployee(fromNumber);
    console.log('👤 Is Employee:', isEmployee);
    
    if (isEmployee && status === 'connected') {
      console.log('⏸️ Employee detected - pausing chat for 2 hours');
      pauseChat(fromNumber, 2);
    }

    // Salvar mensagem
    await saveMessage(msg.id._serialized, fromNumber, msg.body, msg.timestamp);
    console.log('💾 Message saved to database');

    // Verificar se está pausado
    const chatPaused = isPaused(fromNumber);
    console.log('⏸️ Chat paused:', chatPaused);
    console.log('🔗 Client status:', status);
    
    if (status === 'connected' && !chatPaused) {
      console.log('✅ Processing message with chatbot...');
      await processChatbotMessage(msg);
    } else {
      if (chatPaused) {
        console.log('⏭️ Skipping - chat is paused');
      }
      if (status !== 'connected') {
        console.log('⏭️ Skipping - client not connected');
      }
    }
    
    console.log('='.repeat(80) + '\n');
  } catch (error) {
    console.error('❌ ERROR in handleIncomingMessage:', error);
    console.error('Stack trace:', error.stack);
  }
}

async function checkIfEmployee(number) {
  const employees = process.env.EMPLOYEE_NUMBERS?.split(',') || [];
  const isEmployee = employees.includes(number);
  console.log('👥 Employee numbers configured:', employees);
  console.log('🔍 Checking number:', number, '- Result:', isEmployee);
  return isEmployee;
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
    console.error('❌ Error saving message:', error);
  }
}

async function processChatbotMessage(msg) {
  try {
    console.log('🤖 Starting chatbot processing...');
    
    const contact = await msg.getContact();
    const fromNumber = contact.id.user;
    
    console.log('📋 Getting or creating session...');
    const sessionId = await getOrCreateSession(fromNumber);
    console.log('✅ Session ID:', sessionId);
    
    console.log('📊 Getting conversation state...');
    const state = await getConversationState(sessionId);
    console.log('✅ Current state:', JSON.stringify(state));
    
    console.log('🧠 Generating chatbot response...');
    const response = await generateChatbotResponse(msg.body, state);
    
    if (response) {
      console.log('✅ Response generated:', response.response.substring(0, 100) + '...');
      console.log('📤 Sending message...');
      
      await sendMessage(fromNumber, response.response);
      console.log('✅ Message sent successfully!');
      
      console.log('💾 Updating conversation state...');
      await updateConversationState(sessionId, response.nextState, response.metadata);
      console.log('✅ State updated to:', response.nextState);
    } else {
      console.log('⚠️ No response generated from chatbot');
    }
  } catch (error) {
    console.error('❌ ERROR in processChatbotMessage:', error);
    console.error('Stack trace:', error.stack);
    
    // Tentar enviar mensagem de erro ao usuário
    try {
      const contact = await msg.getContact();
      const fromNumber = contact.id.user;
      await sendMessage(fromNumber, 'Desculpe, estou tendo problemas técnicos no momento. Um atendente humano entrará em contato em breve. 🙏');
    } catch (sendError) {
      console.error('❌ Could not send error message to user:', sendError);
    }
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
    console.error('❌ Error getting/creating session:', error);
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
    console.error('❌ Error getting conversation state:', error);
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
    console.error('❌ Error updating conversation state:', error);
  }
}

async function generateChatbotResponse(message, stateObj) {
  const openai = require('../config/openai');
  const { state, metadata } = stateObj;

  console.log('🔑 Checking OpenAI API Key...');
  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY not configured in .env file!');
    throw new Error('OpenAI API Key not configured');
  }
  console.log('✅ OpenAI API Key configured');

  const systemPrompt = `Você é um assistente útil para uma empresa de estofados. Seu papel é:
1. Receber os clientes gentilmente
2. Classificar a solicitação como "Fabricação" ou "Reforma"
3. Colher informações do cliente, resumo do problema, etc.
4. Orientá-los através do processo

Para Reforma: Solicitar fotos e informar que a equipe responderá
Para Fabricação: Sugerir uma reunião de 1 hora ou visita ao local

Mantenha as respostas concisas e profissionais em português brasileiro.`;

  const conversation = [
    { role: 'system', content: systemPrompt },
  ];

  if (metadata.history) {
    conversation.push(...metadata.history);
  }

  conversation.push({ role: 'user', content: message });

  try {
    console.log('🤖 Calling OpenAI API...');
    console.log('📝 Conversation length:', conversation.length, 'messages');
    
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: conversation,
      temperature: 0.7,
    });

    console.log('✅ OpenAI response received');
    const response = completion.choices[0].message.content;
    console.log('💬 Response length:', response.length, 'chars');

    if (!metadata.history) metadata.history = [];
    metadata.history.push(
      { role: 'user', content: message },
      { role: 'assistant', content: response }
    );

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
    console.error('❌ ERROR calling OpenAI:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      status: error.status,
      type: error.type
    });
    
    // Retornar resposta padrão em caso de erro
    return {
      response: 'Olá! Obrigado por entrar em contato. No momento estou com problemas técnicos, mas um de nossos atendentes responderá em breve. Por favor, descreva o que você precisa.',
      nextState: state,
      metadata
    };
  }
}

async function sendMessage(phoneNumber, response) {
  if (!client || status !== 'connected') {
    console.error('❌ Cannot send message - client not connected');
    throw new Error('WhatsApp client not connected');
  }

  try {
    const chatId = phoneNumber.includes('@c.us') 
      ? phoneNumber 
      : `${phoneNumber}@c.us`;
    
    console.log('📤 Sending to:', chatId);
    console.log('💬 Message preview:', response.substring(0, 50) + '...');
    
    await client.sendMessage(chatId, response);
    console.log('✅ Message sent successfully!');
  } catch (error) {
    console.error('❌ Error sending message:', error);
    throw error;
  }
}

function pauseBot(hours = 2) {
  pausedUntil = new Date(Date.now() + hours * 60 * 60 * 1000);
  console.log(`⏸️ Bot paused globally until ${pausedUntil}`);
}

function pauseChat(phoneNumber, hours = 2) {
  const pauseUntil = new Date(Date.now() + hours * 60 * 60 * 1000);
  chatPauses.set(phoneNumber, pauseUntil);
  console.log(`⏸️ Chat ${phoneNumber} paused until ${pauseUntil}`);
}

function resumeBot() {
  pausedUntil = null;
  console.log('▶️ Bot resumed');
}

function isPaused(phoneNumber = null) {
  // Check global pause first
  if (pausedUntil) {
    if (Date.now() > pausedUntil.getTime()) {
      pausedUntil = null;
    } else {
      return true;
    }
  }

  // Check chat-specific pause if phoneNumber is provided
  if (phoneNumber && chatPauses.has(phoneNumber)) {
    const chatPauseUntil = chatPauses.get(phoneNumber);
    if (Date.now() > chatPauseUntil.getTime()) {
      chatPauses.delete(phoneNumber);
    } else {
      return true;
    }
  }

  return false;
}

function getQRString() {
  console.log('📲 QR String requested:', {
    hasQRString: !!qrString,
    qrLength: qrString?.length || 0,
    status: status
  });
  
  return qrString;
}

function getStatus() {
  const statusInfo = {
    status,
    paused: isPaused(),
    pausedUntil: pausedUntil?.toISOString(),
    hasQRString: !!qrString,
    qrStringLength: qrString?.length || 0,
    clientExists: !!client,
    initializationAttempt,
    chatPauses: Object.fromEntries(chatPauses)
  };
  
  console.log('📊 Status requested:', statusInfo);
  return statusInfo;
}

module.exports = {
  initializeWhatsApp,
  connect: async () => {
    console.log('🔌 Connect called');
    
    try {
      const cli = await initializeWhatsApp(false);
      console.log('⏳ Initializing WhatsApp client...');
      await cli.initialize();
      console.log('✅ Client initialized successfully');
    } catch (error) {
      console.error('❌ Error during connection:', error.message);
      
      if (initializationAttempt < 3) {
        console.log('🔄 Retrying with cleanup...');
        await killOldChromeProcesses();
        cleanupSession();
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        const cli = await initializeWhatsApp(true);
        await cli.initialize();
      } else {
        throw new Error('Failed after multiple attempts. Please delete whatsapp-session folder manually.');
      }
    }
  },
  disconnect: async () => {
    console.log('🔌 Disconnect called');
    if (client) {
      try {
        await client.destroy();
      } catch (err) {
        console.log('⚠️ Error destroying client:', err.message);
      }
      client = null;
      status = 'disconnected';
      qrString = '';
      cleanupSession();
      console.log('✅ Client destroyed and cleaned up');
    }
  },
  pauseBot,
  pauseChat,
  resumeBot,
  getQRString,
  getStatus,
  sendMessage,
  cleanupSession,
};