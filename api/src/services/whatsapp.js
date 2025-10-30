const { Client, LocalAuth } = require('whatsapp-web.js');
const pool = require('../config/database');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const {
  createCalendarEventWithValidation,
} = require('../config/google-calendar');
const { createAppointment } = require('../models/agendamento');

let client = null;
let qrString = '';
let status = 'disconnected';
let pausedUntil = null;
let initializationAttempt = 0;
let chatPauses = new Map();

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
    
    // Tentar reconectar automaticamente após 30 segundos
    console.log('🔄 Will attempt to reconnect in 30 seconds...');
    setTimeout(async () => {
      try {
        console.log('🔄 Attempting automatic reconnection...');
        await initializeWhatsApp(true);
        await client.initialize();
      } catch (err) {
        console.error('❌ Auto-reconnection failed:', err.message);
      }
    }, 30000);
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
    
    // Verificar se é mensagem de grupo e ignorar
    const chat = await msg.getChat();
    if (chat.isGroup) {
      console.log('👥 Message from GROUP - IGNORING');
      console.log('='.repeat(80) + '\n');
      return;
    }
    
    const contact = await msg.getContact();
    const fromNumber = contact.id.user;
    
    console.log('📞 From:', fromNumber);
    console.log('💬 Message:', msg.body);
    console.log('🆔 Message ID:', msg.id._serialized);
    
    const isEmployee = await checkIfEmployee(fromNumber);
    console.log('👤 Is Employee:', isEmployee);
    
    if (isEmployee && status === 'connected') {
      console.log('💼 Employee replying to client - pausing bot for this chat');
      console.log(`⏸️ Pausing chat with ${fromNumber} for 2 hours`);
      
      await markChatAsHumanHandled(fromNumber);
      pauseChat(fromNumber, 2);
    }

    await saveMessage(msg.id._serialized, fromNumber, msg.body, msg.timestamp);
    console.log('💾 Message saved to database');

    const chatPaused = isPaused(fromNumber);
    console.log('⏸️ Chat paused:', chatPaused);
    console.log('🔗 Client status:', status);
    
    if (isEmployee) {
      console.log('⏭️ Skipping - message from employee');
    } else if (chatPaused) {
      console.log('⏭️ Skipping - chat is paused (human is handling)');
    } else if (status === 'connected') {
      console.log('✅ Processing message with chatbot...');
      await processChatbotMessage(msg);
    } else {
      console.log('⏭️ Skipping - client not connected');
    }
    
    console.log('='.repeat(80) + '\n');
  } catch (error) {
    console.error('❌ ERROR in handleIncomingMessage:', error);
    console.error('Stack trace:', error.stack);
  }
}

async function checkIfEmployee(number) {
  const employees = process.env.EMPLOYEE_NUMBERS?.split(',').map(n => n.trim()) || [];
  const isEmployee = employees.includes(number);
  console.log('👥 Employee numbers configured:', employees);
  console.log('🔍 Checking number:', number, '- Result:', isEmployee);
  return isEmployee;
}

async function markChatAsHumanHandled(phoneNumber) {
  try {
    console.log(`📝 Marking chat ${phoneNumber} as human-handled`);
    
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
      
      console.log('✅ Chat marked as human-handled');
    }
  } catch (error) {
    console.error('❌ Error marking chat as human-handled:', error);
  }
}

async function saveMessage(messageId, fromNumber, body, timestamp) {
  try {
    const tsMs = typeof timestamp === 'number' ? (timestamp * 1000) : Date.now();
    await pool.query(
      `INSERT INTO messages (id, from_number, body, timestamp, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [messageId, fromNumber, body, tsMs]
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
    const response = await generateChatbotResponse(msg.body, state, contact);

    // Tentar agendar automaticamente se mensagem tiver data/horário e tipo
    // Tentar agendar automaticamente se mensagem tiver data/horário e tipo
    const schedulingResult = await tryScheduleFromMessage(msg.body, state.metadata, contact, fromNumber);
    if (schedulingResult?.scheduled) {
      // Mensagem determinística de confirmação (evita contradição do LLM)
      const confirmation = `✅ Agendamento confirmado: ${schedulingResult.humanReadable}\nLink: ${schedulingResult.htmlLink || '—'}`;
      const followup = '\n\nSe precisar alterar ou cancelar, me avise por aqui. 👍';
      response.response = `${confirmation}${followup}`;
      // Persistiremos metadados após enviar a resposta (já abaixo)
      response.metadata = {
        ...response.metadata,
        lastScheduledEvent: schedulingResult.eventPublic,
      };
    } else if (schedulingResult && schedulingResult.scheduled === false) {
      // Mensagem determinística de indisponibilidade (não deixar o LLM confirmar acidentalmente)
      const header = schedulingResult.reason === 'outside_hours'
        ? '⌛ Infelizmente este horário está fora do nosso expediente (8h às 18h, seg a sex).'
        : '⚠️ Este horário já está ocupado para esta modalidade.';
      const sugg = (schedulingResult.suggestions || [])
        .slice(0, 2)
        .map(s => `• ${s.formatted}`)
        .join('\n');

      const suggestionsText = sugg ? `\n\nSugestões disponíveis:\n${sugg}` : '';
      response.response = `${header}${suggestionsText}\n\nPosso reservar um desses horários para você?`;
    } else if (schedulingResult === null) {
      // NÃO conseguiu parsear data/hora - FORÇAR o bot a pedir formato correto
      console.log('⚠️ Parse falhou - forçando bot a pedir formato DD/MM');
      
      // Checar se a mensagem contém termos relativos
      const hasRelativeTerms = /\b(amanha|amanhã|hoje|depois|segunda|terça|terca|quarta|quinta|sexta|sabado|sábado|domingo)\b/i.test(msg.body);
      
      if (hasRelativeTerms) {
        // Sobrescrever resposta da IA para forçar pedido de data correta
        response.response = `Para garantir que não haja erros no agendamento, preciso que você me informe a data no formato DD/MM e o horário.\n\n📅 Exemplo: 31/10 às 14:00\n\nQual data e horário você prefere? 😊`;
      }
    }
    
    // Tentar cancelar/remarcar pelo texto
    const cancelResult = await tryCancelOrRescheduleFromMessage(msg.body, fromNumber);
    if (cancelResult?.changed) {
      const confirmation = cancelResult.type === 'cancel'
        ? `✅ Agendamento cancelado: ${cancelResult.humanReadable}`
        : `✅ Agendamento remarcado: ${cancelResult.humanReadable}`;
      response.response = `${confirmation}\n\n${response.response}`;
    }
    
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
    
    // Só tentar enviar mensagem de erro se ainda estiver conectado
    if (status === 'connected' && client) {
      try {
        const contact = await msg.getContact();
        const fromNumber = contact.id.user;
        await sendMessage(fromNumber, 'Desculpe, estou tendo problemas técnicos no momento. Um atendente humano entrará em contato em breve. 🙏');
      } catch (sendError) {
        console.error('❌ Could not send error message to user:', sendError.message);
      }
    } else {
      console.error('⚠️ Cannot send error message - client disconnected');
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

async function generateChatbotResponse(message, stateObj, contact) {
  const openai = require('../config/openai');
  const { state, metadata } = stateObj;

  console.log('🔑 Checking OpenAI API Key...');
  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY not configured in .env file!');
    throw new Error('OpenAI API Key not configured');
  }
  console.log('✅ OpenAI API Key configured');

  const customerName = contact.pushname || contact.name || 'Cliente';

  const systemPrompt = `
  Você é **Maria**, a especialista virtual da **Artestofados**, empresa especializada em **fabricação e reforma de estofados** em João Pessoa - PB.  
  Seu papel é **atender clientes interessados nos serviços da loja**, guiando-os com simpatia e clareza até a coleta de informações ou agendamento de visita.

  ---

  🎯 **OBJETIVO PRINCIPAL**
  Atender **apenas perguntas relacionadas à Artestofados**, seus **serviços, produtos, orçamentos, reformas, fabricações, agendamentos e informações da loja**.

  ❌ **NÃO RESPONDER** a perguntas fora do contexto da empresa (como dúvidas pessoais, piadas, política, tecnologia, etc).  
  Em caso de perguntas fora do escopo, diga gentilmente:
  > "Posso te ajudar com informações sobre nossos serviços de estofados, reformas ou fabricação. 😊 Quer saber mais sobre algum deles?"

  ---

  💬 **PERSONALIDADE E TOM**
  - Amigável, calorosa e empática 💙  
  - Respostas concisas, mas completas  
  - Use emojis de forma leve e natural  
  - Trate o cliente pelo nome quando possível  
  - Seja prestativa, paciente e educada  
  - Nunca pressione o cliente  

  ---

  🧭 **FLUXO DA CONVERSA**

  ### 1. BOAS-VINDAS (state: initial)
  - Cumprimente com calor e simpatia  
  - Apresente-se como *Maria, especialista virtual da Artestofados*  
  - Pergunte o nome do cliente, se ainda não souber  
  - Pergunte como pode ajudar  

  ---

  ### 2. CLASSIFICAÇÃO DO SERVIÇO (state: classifying)
  - Identifique se o cliente deseja **fabricação** ou **reforma**
  - Se não ficar claro, pergunte educadamente  
  - **Reforma:** explique que será necessário enviar fotos do móvel  
  - **Fabricação:** pergunte se o cliente já tem um projeto em mente  

  ---

  ### 3. COLETA DE INFORMAÇÕES (state: collecting_info)

  #### 🛋️ Para REFORMA:
  - Pergunte qual o tipo de móvel, tamanho e problema  
  - Solicite fotos do móvel  
  - Pergunte se já tem tecido escolhido  
  - Agradeça e informe que a equipe retornará em breve  

  #### 🪑 Para FABRICAÇÃO:
  - Pergunte sobre o tipo de projeto desejado  
  - Caso queira catálogo, diga:
    > "Durante a visita, você poderá conhecer nossos modelos, mas a maioria é personalizada conforme seu gosto 😊"
  - Se perguntar sobre valores:
    > "Os valores variam conforme o projeto, mas posso agendar uma reunião ou visita para orçamento mais preciso."
  - Ofereça:  
    > "Posso agendar uma reunião online ou uma visita na loja. Qual você prefere?"

  ---

  📅 **REGRAS DE AGENDAMENTO (CRÍTICAS)**

  ⚠️ **Formato obrigatório:** DD/MM/AAAA às HH:MM  
  - **NUNCA** aceite datas como “amanhã”, “hoje”, “segunda-feira”, “semana que vem”, etc.  
  - Se o cliente usar termos relativos, responda:
    > "Para evitar erros, preciso da data completa no formato DD/MM/AAAA e o horário (por exemplo: 31/10/2025 às 14:00). Qual data você prefere?"
  - **NUNCA** confirme ou diga “está agendado”, “confirmado” ou “marcado” sem antes receber uma data **no formato DD/MM/AAAA às HH:MM**.
  - Após receber o formato correto, repita os detalhes exatamente como o cliente informou, confirmando que entendeu.

  ---

  ### 4. FINALIZAÇÃO (state: completed)
  - Agradeça pela preferência e simpatia do cliente  
  - Reforce os próximos passos  
  - Deixe o canal aberto para dúvidas futuras  
  - Despeça-se de forma gentil e calorosa  
    > "Obrigada pelo contato! 💙 Ficarei feliz em ajudar sempre que precisar."

  ---

  🏢 **INFORMAÇÕES DA EMPRESA**
  - **Nome:** Artestofados  
  - **Endereço:** Av. Almirante Barroso, 389, Centro – João Pessoa – PB  
  - **CNPJ:** 08.621.718/0001-07  
  - **Horário de funcionamento:** Segunda a sexta, das 07:30 às 18:00  

  ---

  💡 **DICAS DE CONDUTA**
  - Faça **uma pergunta por vez**  
  - Sempre confirme o entendimento antes de prosseguir  
  - Seja educada, acolhedora e profissional  
  - Evite respostas automáticas ou frias  
  - Mantenha o foco nos serviços da empresa  
  - **NUNCA confirme agendamento sem formato DD/MM/AAAA e HH:MM**  
  - **NUNCA responda a perguntas fora do contexto da loja**
  `;


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
      model: 'gpt-4o-mini',
      messages: conversation,
      temperature: 0.7,
      max_tokens: 800
    });

    console.log('✅ OpenAI response received');
    const response = completion.choices[0].message.content;
    console.log('💬 Response length:', response.length, 'chars');

    if (!metadata.history) metadata.history = [];
    metadata.history.push(
      { role: 'user', content: message },
      { role: 'assistant', content: response }
    );

    if (!metadata.customerName && customerName !== 'Cliente') {
      metadata.customerName = customerName;
    }

    let nextState = state;
    const lowerMessage = message.toLowerCase();
    
    if (state === 'initial') {
      nextState = 'classifying';
    } else if (state === 'classifying') {
      if (lowerMessage.includes('reform') || lowerMessage.includes('conser') || lowerMessage.includes('arrum')) {
        metadata.serviceType = 'reforma';
        nextState = 'collecting_info';
      } else if (lowerMessage.includes('fabric') || lowerMessage.includes('fazer') || lowerMessage.includes('novo')) {
        metadata.serviceType = 'fabricacao';
        nextState = 'collecting_info';
      }
    } else if (state === 'collecting_info') {
      if (metadata.serviceType === 'reforma' && (lowerMessage.includes('foto') || lowerMessage.includes('image'))) {
        nextState = 'waiting_photos';
      } else if (metadata.serviceType === 'fabricacao' && (lowerMessage.includes('agendar') || lowerMessage.includes('reunião') || lowerMessage.includes('visita'))) {
        nextState = 'scheduling';
      }
      
      if (lowerMessage.includes('obrigad') || lowerMessage.includes('valeu') || lowerMessage.includes('ok')) {
        nextState = 'completed';
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
    
    return {
      response: `Olá! 😊 Seja bem-vindo(a) à Artestofados!\n\nNo momento estou com um probleminha técnico, mas fique tranquilo(a)! Um dos nossos atendentes vai te responder em breve.\n\nPor favor, me conte: como podemos ajudar você hoje?`,
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
    
    // Verificar se o chat existe antes de enviar
    try {
      const chat = await client.getChatById(chatId);
      if (!chat) {
        console.error('❌ Chat not found:', chatId);
        throw new Error('Chat not found');
      }
    } catch (chatError) {
      console.error('❌ Error getting chat:', chatError.message);
      // Tentar enviar mesmo assim
    }
    
    await client.sendMessage(chatId, response);
    console.log('✅ Message sent successfully!');
  } catch (error) {
    console.error('❌ Error sending message:', error);
    
    // Se erro de conexão, marcar como desconectado
    if (error.message.includes('getChat') || error.message.includes('Evaluation failed')) {
      console.error('🔌 WhatsApp connection lost - marking as disconnected');
      status = 'disconnected';
      client = null;
    }
    
    throw error;
  }
}

// ===== Helpers de agendamento pelo texto =====
function inferAgendaTypeFromText(text, fallback) {
  const t = (text || '').toLowerCase();
  if (t.includes('online') || t.includes('vídeo') || t.includes('video') || t.includes('reuni')) return 'online';
  if (t.includes('loja') || t.includes('visita') || t.includes('presenc')) return 'loja';
  return fallback || '';
}

// ENCONTRE ESTA FUNÇÃO (linha ~14):
function buildBrazilDate(year, monthIndex, day, hour = 0, minute = 0, second = 0, ms = 0) {
  return new Date(Date.UTC(year, monthIndex, day, hour + 3, minute, second, ms));
}

// ADICIONE LOGO APÓS:
function getBrazilToday() {
  const nowUTC = new Date();
  const formatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = formatter.formatToParts(nowUTC);
  const day = parseInt(parts.find(p => p.type === 'day').value, 10);
  const month = parseInt(parts.find(p => p.type === 'month').value, 10) - 1;
  const year = parseInt(parts.find(p => p.type === 'year').value, 10);
  return new Date(year, month, day);
}

function parseDateTimeFromText(text) {
  if (!text) return null;
  const t = text.toLowerCase().trim();
  const nowBrazil = getBrazilToday(); // Data de HOJE no Brasil

  function normalizeHourMinute(hhStr, mmStr) {
    const hour = Math.max(0, Math.min(23, parseInt(hhStr, 10)));
    const minute = mmStr != null ? Math.max(0, Math.min(59, parseInt(mmStr, 10))) : 0;
    return { hour, minute };
  }

  // ===== REMOVIDO: Expressões relativas (hoje, amanhã, etc) =====
  // Agora só aceita datas no formato DD/MM/AAAA ou DD/MM
  
  // Data explícita: DD/MM/AAAA ou DD/MM
  let explicitDate = null;
  let m = t.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (m) {
    const [_, dd, mm, yyyy] = m;
    explicitDate = new Date(parseInt(yyyy, 10), parseInt(mm, 10) - 1, parseInt(dd, 10));
    console.log('📅 Data explícita detectada:', explicitDate.toLocaleDateString('pt-BR'));
  } else {
    m = t.match(/\b(\d{1,2})\/(\d{1,2})\b/);
    if (m) {
      const [_, dd, mm] = m;
      explicitDate = new Date(nowBrazil.getFullYear(), parseInt(mm, 10) - 1, parseInt(dd, 10));
      console.log('📅 Data explícita (sem ano) detectada:', explicitDate.toLocaleDateString('pt-BR'));
    }
  }

  // Se não encontrou data no formato DD/MM, retorna null
  if (!explicitDate) {
    console.log('❌ Data não encontrada no formato DD/MM ou DD/MM/AAAA');
    return null;
  }

  // Hora: "às 14h30", "14:00", "14h", "as 9h", "10hs"
  let timeMatch = t.match(/(?:\bàs|\bas)?\s*(\d{1,2})(?::(\d{2}))?\s*(h|hs)?\b/);
  let hour = null, minute = null;
  if (timeMatch) {
    const { hour: h, minute: mnt } = normalizeHourMinute(timeMatch[1], timeMatch[2]);
    hour = h; minute = mnt;
    console.log('⏰ Horário detectado:', `${hour}:${String(minute).padStart(2, '0')}`);
  } else {
    console.log('❌ Horário não encontrado');
    return null;
  }

  const finalHour = hour != null ? hour : 0;
  const finalMinute = minute != null ? minute : 0;
  const finalDate = buildBrazilDate(
    explicitDate.getFullYear(),
    explicitDate.getMonth(),
    explicitDate.getDate(),
    finalHour,
    finalMinute,
    0,
    0
  );

  if (isNaN(finalDate.getTime())) {
    console.log('❌ Data final inválida');
    return null;
  }
  
  console.log('✅ Data final parseada:', finalDate.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }));
  return finalDate;
}

async function tryCancelOrRescheduleFromMessage(message, phoneNumber) {
  try {
    const t = (message || '').toLowerCase();
    const wantsCancel = t.includes('cancelar') || t.includes('cancela') || t.includes('desmarcar');
    const wantsReschedule = t.includes('remarcar') || t.includes('remarca') || t.includes('alterar') || t.includes('mudar horário') || t.includes('mudar horario');
    if (!wantsCancel && !wantsReschedule) return null;

    const { findLatestByPhone, findConflicts } = require('../models/agendamento');
    const latest = await findLatestByPhone(phoneNumber);
    if (!latest) return null;

    const start = new Date(latest.start_time);
    const end = new Date(latest.end_time);
    const humanBase = `${latest.summary} em ${start.toLocaleString('pt-BR')} - ${end.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;

    if (wantsCancel) {
      try {
        if (latest.calendar_event_id) {
          const { getAuthClient } = require('../config/google-calendar');
          const auth = getAuthClient();
          const calendar = require('googleapis').google.calendar({ version: 'v3', auth });
          await calendar.events.delete({ calendarId: 'primary', eventId: latest.calendar_event_id });
        }
      } catch (err) {
        console.error('⚠️ Could not delete calendar event:', err.message);
      }
      await pool.query('DELETE FROM appointments WHERE id = $1', [latest.id]);
      return { changed: true, type: 'cancel', humanReadable: humanBase };
    }

    if (wantsReschedule) {
      const newDate = parseDateTimeFromText(message);
      if (!newDate) return null;
      const duration = end.getTime() - start.getTime();
      const newEnd = new Date(newDate.getTime() + duration);

      const conflicts = await findConflicts(newDate, newEnd, latest.agenda_type);
      const conflictsFiltered = conflicts.filter(c => c.id !== latest.id);
      if (conflictsFiltered.length > 0) return null;

      if (latest.calendar_event_id) {
        try {
          const { getAuthClient } = require('../config/google-calendar');
          const auth = getAuthClient();
          const calendar = require('googleapis').google.calendar({ version: 'v3', auth });
          await calendar.events.patch({
            calendarId: 'primary',
            eventId: latest.calendar_event_id,
            resource: {
              start: { dateTime: newDate.toISOString(), timeZone: 'America/Sao_Paulo' },
              end: { dateTime: newEnd.toISOString(), timeZone: 'America/Sao_Paulo' },
            }
          });
        } catch (err) {
          console.error('⚠️ Could not patch calendar event:', err.message);
        }
      }

      await pool.query(
        `UPDATE appointments SET start_time = $2, end_time = $3, updated_at = NOW() WHERE id = $1`,
        [latest.id, newDate, newEnd]
      );

      const humanNew = `${latest.summary} em ${newDate.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} - ${newEnd.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}`;
      return { changed: true, type: 'reschedule', humanReadable: humanNew };
    }

    return null;
  } catch (err) {
    console.error('❌ Cancel/Reschedule parse failed:', err.message);
    return null;
  }
}

async function tryScheduleFromMessage(message, metadata, contact, phoneNumber) {
  try {
    const customerName = contact.pushname || contact.name || '';
    const rawType = inferAgendaTypeFromText(message, metadata?.agendaType);
    const agendaType = (rawType === 'visita' || rawType === 'presencial') ? 'loja' : rawType;
    const start = parseDateTimeFromText(message);
    
    console.log('\n🔍 === TENTANDO AGENDAR ===');
    console.log('📝 Mensagem:', message);
    console.log('📅 Data parseada:', start?.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }));
    console.log('🏷️ Tipo de agenda:', agendaType);
    
    if (!agendaType || !start) {
      console.log('❌ Dados insuficientes para agendamento');
      return null;
    }
    const duration = 60;
    const end = new Date(start.getTime() + duration * 60000);

    console.log('⏰ Horário solicitado:', start.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }));
    console.log('⏰ Horário fim:', end.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }));

    // Validar expediente (8-18h, dias úteis) em America/Sao_Paulo
    const { isWithinWorkingHours, suggestAlternativeTimes } = require('../config/google-calendar');
    if (!isWithinWorkingHours(start) || !isWithinWorkingHours(end)) {
      console.log('⚠️ FORA DO HORÁRIO DE EXPEDIENTE');
      let suggestions = [];
      try {
        suggestions = await suggestAlternativeTimes(start, duration, { agendaType });
      } catch (e) {
        suggestions = [];
      }
      return {
        scheduled: false,
        reason: 'outside_hours',
        suggestions: suggestions.map(s => ({
          start: s.start,
          end: s.end,
          formatted: `${s.start.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} - ${s.end.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}`
        }))
      };
    }

    const autoSummary = agendaType === 'online'
      ? `Atendimento - Reunião Online${customerName ? ` | ${customerName}` : ''}`
      : `Atendimento - Visita à Loja${customerName ? ` | ${customerName}` : ''}`;

    // Verificar conflitos no banco (mesmo tipo)
    const { findConflicts } = require('../models/agendamento');
    const dbConflicts = await findConflicts(start, end, agendaType);
    
    console.log('🔍 Conflitos encontrados:', dbConflicts.length);
    if (dbConflicts.length > 0) {
      console.log('❌ HORÁRIO JÁ OCUPADO');
      dbConflicts.forEach(c => {
        console.log(`   - ${c.summary}: ${new Date(c.start_time).toLocaleString('pt-BR')} - ${new Date(c.end_time).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`);
      });
      
      let suggestions = [];
      try {
        suggestions = await suggestAlternativeTimes(start, duration, { agendaType });
        console.log('💡 Sugestões alternativas:', suggestions.length);
      } catch (e) {
        suggestions = [];
      }
      try {
        suggestions = await suggestAlternativeTimes(start, duration, { agendaType });
      } catch (e) {
        suggestions = [];
      }
      return {
        scheduled: false,
        reason: 'conflict',
        suggestions: suggestions.map(s => ({
          start: s.start,
          end: s.end,
          formatted: `${s.start.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} - ${s.end.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}`
        }))
      };
    }

    // Persistir no banco (sem criar evento no Google Calendar) e somente confirmar se salvar com sucesso
    
    try {
      console.log('💾 Salvando agendamento no banco...');
      await createAppointment({
        calendarEventId: null,
        summary: autoSummary,
        description: '',
        startTime: start,
        endTime: end,
        agendaType,
        clientName: customerName || null,
        phoneNumber: phoneNumber || null,
      });
      const humanReadable = `${agendaType === 'online' ? 'Reunião online' : 'Visita à loja'} em ${start.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} - ${end.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}`;
      console.log('✅ AGENDAMENTO CONFIRMADO:', humanReadable);
      return {
        scheduled: true,
        humanReadable,
        htmlLink: undefined,
        eventPublic: {
          id: undefined,
          summary: autoSummary,
          start: start.toISOString(),
          end: end.toISOString(),
          agendaType,
          htmlLink: undefined,
        }
      };
    } catch (persistErr) {
      console.error('⚠️ Could not persist appointment:', persistErr.message);
      const reason = String(persistErr.message || '').includes('conflict') ? 'conflict' : 'persist_error';
      return {
        scheduled: false,
        reason,
        suggestions: []
      };
    }
  } catch (err) {
    console.error('❌ Scheduling from message failed:', err.message);
    return { scheduled: false, reason: 'error', suggestions: [] };
  }
}

function pauseBot(hours = 2) {
  pausedUntil = new Date(Date.now() + hours * 60 * 60 * 1000);
  console.log(`⏸️ Bot paused globally until ${pausedUntil}`);
}

function pauseChat(phoneNumber, hours = 2) {
  const pauseUntil = new Date(Date.now() + hours * 60 * 60 * 1000);
  chatPauses.set(phoneNumber, pauseUntil);
  console.log(`⏸️ Chat ${phoneNumber} paused until ${pauseUntil.toLocaleString('pt-BR')}`);
}

function resumeBot() {
  pausedUntil = null;
  console.log('▶️ Bot resumed globally');
}

function resumeChat(phoneNumber) {
  if (chatPauses.has(phoneNumber)) {
    chatPauses.delete(phoneNumber);
    console.log(`▶️ Chat ${phoneNumber} resumed`);
    return true;
  }
  return false;
}

function isPaused(phoneNumber = null) {
  if (pausedUntil) {
    if (Date.now() > pausedUntil.getTime()) {
      pausedUntil = null;
    } else {
      return true;
    }
  }

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
    chatPauses: Array.from(chatPauses.entries()).map(([phone, pauseUntil]) => ({
      phone,
      pausedUntil: pauseUntil.toISOString()
    }))
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
  resumeChat,
  getQRString,
  getStatus,
  sendMessage,
  cleanupSession,
};