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
let chatPauses = new Map(); // Map para pausas específicas de chat

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
    if (status === 'connected') return;

    try {
      const QRCode = require('qrcode');
      const qrBase64 = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
      qrString = qrBase64;
      status = 'qr_ready';
      const qrcodeTerminal = require('qrcode-terminal');
      qrcodeTerminal.generate(qr, { small: true });
    } catch {
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
    console.log('✅ WhatsApp client CONNECTED and READY!');
  });

  client.on('authenticated', () => {
    status = 'authenticated';
    console.log('🔐 Authentication successful');
  });

  client.on('auth_failure', (msg) => {
    status = 'auth_failure';
    qrString = '';
    console.error('❌ Authentication failed:', msg);
  });

  client.on('disconnected', (reason) => {
    status = 'disconnected';
    qrString = '';
    cleanupSession();
    client = null;
    console.log('🔌 Client disconnected:', reason);
  });

  client.on('message', async (msg) => {
    await handleIncomingMessage(msg);
  });

  console.log('⏳ Client created, waiting for initialization...');
  return client;
}

async function handleIncomingMessage(msg) {
  try {
    const contact = await msg.getContact();
    const fromNumber = contact.id.user;

    const isEmployee = await checkIfEmployee(fromNumber);

    if (isEmployee && status === 'connected') {
      try {
        const chat = await msg.getChat();
        if (!chat.isGroup) {
          await markChatAsHumanHandled(fromNumber);
          pauseChat(fromNumber, 2);
        }
      } catch {}
    }

    await saveMessage(msg.id._serialized, fromNumber, msg.body, msg.timestamp);

    const chatPaused = isPaused(fromNumber);

    if (!isEmployee && !chatPaused && status === 'connected') {
      await processChatbotMessage(msg);
    }

  } catch (error) {
    console.error('❌ ERROR in handleIncomingMessage:', error);
  }
}

async function checkIfEmployee(number) {
  const employees = process.env.EMPLOYEE_NUMBERS?.split(',').map(n => n.trim()) || [];
  return employees.includes(number);
}

async function markChatAsHumanHandled(phoneNumber) {
  try {
    const result = await pool.query(
      `SELECT id, metadata FROM sessions WHERE phone_number = $1`,
      [phoneNumber]
    );
    
    if (result.rows.length > 0) {
      const session = result.rows[0];
      const metadata = session.metadata || {};
      metadata.humanHandled = true;
      metadata.humanHandledAt = new Date().toISOString();
      
      await pool.query(
        `UPDATE sessions SET metadata = $1, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(metadata), session.id]
      );
    }
  } catch (error) {
    console.error('❌ Error marking chat as human-handled:', error);
  }
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
    const contact = await msg.getContact();
    const fromNumber = contact.id.user;

    const sessionId = await getOrCreateSession(fromNumber);
    const state = await getConversationState(sessionId);
    const response = await generateChatbotResponse(msg.body, state);

    if (response) {
      await sendMessage(fromNumber, response.response);
      await updateConversationState(sessionId, response.nextState, response.metadata);
    }
  } catch (error) {
    console.error('❌ ERROR in processChatbotMessage:', error);
    try {
      const contact = await msg.getContact();
      const fromNumber = contact.id.user;
      await sendMessage(fromNumber, 'Desculpe, estou com problemas técnicos no momento. Um atendente entrará em contato em breve. 🙏');
    } catch {}
  }
}

async function getOrCreateSession(phoneNumber) {
  try {
    const result = await pool.query(
      `SELECT id FROM sessions WHERE phone_number = $1`,
      [phoneNumber]
    );

    if (result.rows.length > 0) return result.rows[0].id;

    const insertResult = await pool.query(
      `INSERT INTO sessions (phone_number, state, created_at)
       VALUES ($1, 'initial', NOW())
       RETURNING id`,
      [phoneNumber]
    );

    return insertResult.rows[0].id;
  } catch (error) {
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
      return { state: result.rows[0].state, metadata: result.rows[0].metadata || {} };
    }
    return { state: 'initial', metadata: {} };
  } catch {
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

  const systemPrompt = `Você é um assistente útil para uma empresa de estofados. 
1. Receba o cliente com cordialidade.
2. Classifique como "Fabricação" ou "Reforma".
3. Para Reforma: Solicite fotos e informe que a equipe entrará em contato.
4. Para Fabricação: Sugira reunião de 1 hora ou visita ao local.
Mantenha respostas curtas, claras e profissionais em português.`;

  const conversation = [{ role: 'system', content: systemPrompt }];
  if (metadata.history) conversation.push(...metadata.history);
  conversation.push({ role: 'user', content: message });

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: conversation,
      temperature: 0.7,
      max_tokens: 800
    });

    const response = completion.choices[0].message.content;

    if (!metadata.history) metadata.history = [];
    metadata.history.push({ role: 'user', content: message }, { role: 'assistant', content: response });

    let nextState = state;
    if (state === 'initial') nextState = 'classified';
    else if (state === 'classified') {
      if (metadata.classification === 'Reforma') nextState = 'waiting_photos';
      else if (metadata.classification === 'Fabricação') nextState = 'scheduling';
    }

    return { response, nextState, metadata };
  } catch (error) {
    return { 
      response: 'Olá! Estou com problemas técnicos, mas um atendente entrará em contato. Por favor, descreva sua solicitação.', 
      nextState: state, 
      metadata 
    };
  }
}

async function sendMessage(phoneNumber, response) {
  if (!client || status !== 'connected') throw new Error('WhatsApp client not connected');
  const chatId = phoneNumber.includes('@c.us') ? phoneNumber : `${phoneNumber}@c.us`;
  await client.sendMessage(chatId, response);
}

function pauseBot(hours = 2) { pausedUntil = new Date(Date.now() + hours * 3600000); }
function pauseChat(phoneNumber, hours = 2) { chatPauses.set(phoneNumber, new Date(Date.now() + hours * 3600000)); }
function resumeBot() { pausedUntil = null; }
function resumeChat(phoneNumber) { chatPauses.delete(phoneNumber); }
function isPaused(phoneNumber = null) {
  if (pausedUntil && Date.now() < pausedUntil.getTime()) return true;
  if (phoneNumber && chatPauses.has(phoneNumber)) {
    if (Date.now() < chatPauses.get(phoneNumber).getTime()) return true;
    chatPauses.delete(phoneNumber);
  }
  return false;
}

function getQRString() { return qrString; }
function getStatus() {
  return {
    status,
    paused: isPaused(),
    pausedUntil: pausedUntil?.toISOString(),
    hasQRString: !!qrString,
    qrStringLength: qrString?.length || 0,
    clientExists: !!client,
    initializationAttempt,
    chatPauses: Array.from(chatPauses.entries()).map(([phone, pauseUntil]) => ({ phone, pausedUntil: pauseUntil.toISOString() }))
  };
}

module.exports = {
  initializeWhatsApp,
  connect: async () => {
    try {
      const cli = await initializeWhatsApp(false);
      await cli.initialize();
    } catch (error) {
      if (initializationAttempt < 3) {
        await killOldChromeProcesses();
        cleanupSession();
        await new Promise(resolve => setTimeout(resolve, 3000));
        const cli = await initializeWhatsApp(true);
        await cli.initialize();
      } else {
        throw new Error('Failed after multiple attempts. Delete whatsapp-session folder manually.');
      }
    }
  },
  disconnect: async () => {
    if (client) {
      try { await client.destroy(); } catch {}
      client = null;
      status = 'disconnected';
      qrString = '';
      cleanupSession();
    }
  },
  pauseBot,
  pauseChat,
  resumeBot,
  resumeChat,
  getQRString,
  getStatus,
  sendMessage,
  cleanupSession,
};
