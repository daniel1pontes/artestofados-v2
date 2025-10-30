const { Client, LocalAuth } = require('whatsapp-web.js');
const pool = require('../config/database');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const {
  createCalendarEventWithValidation,
  checkTimeSlotAvailability,
  suggestAlternativeTimes,
  isWithinWorkingHours,
} = require('../config/google-calendar');
const { createAppointment, findConflicts } = require('../models/agendamento');
const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

let client = null;
let qrString = '';
let status = 'disconnected';
let pausedUntil = null;
let initializationAttempt = 0;
let chatPauses = new Map();

// ========== FERRAMENTAS DO GOOGLE CALENDAR ==========

const calendarTools = [
  {
    type: 'function',
    function: {
      name: 'verificar_disponibilidade',
      description: 'Verifica se um horário específico está disponível para agendamento',
      parameters: {
        type: 'object',
        properties: {
          data: {
            type: 'string',
            description: 'Data no formato DD/MM/AAAA',
          },
          horario: {
            type: 'string',
            description: 'Horário no formato HH:MM (ex: 14:00)',
          },
          tipo: {
            type: 'string',
            enum: ['online', 'loja'],
            description: 'Tipo de agendamento: online (reunião) ou loja (visita presencial)',
          },
        },
        required: ['data', 'horario', 'tipo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sugerir_horarios',
      description: 'Sugere horários alternativos disponíveis próximos à data solicitada',
      parameters: {
        type: 'object',
        properties: {
          data: {
            type: 'string',
            description: 'Data desejada no formato DD/MM/AAAA',
          },
          tipo: {
            type: 'string',
            enum: ['online', 'loja'],
            description: 'Tipo de agendamento: online (reunião) ou loja (visita presencial)',
          },
        },
        required: ['data', 'tipo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'criar_agendamento',
      description: 'Cria um novo agendamento no Google Calendar após confirmar disponibilidade',
      parameters: {
        type: 'object',
        properties: {
          cliente_nome: {
            type: 'string',
            description: 'Nome completo do cliente',
          },
          data: {
            type: 'string',
            description: 'Data do agendamento no formato DD/MM/AAAA',
          },
          horario: {
            type: 'string',
            description: 'Horário do agendamento no formato HH:MM',
          },
          tipo: {
            type: 'string',
            enum: ['online', 'loja'],
            description: 'Tipo: online (reunião) ou loja (visita presencial)',
          },
          duracao: {
            type: 'number',
            description: 'Duração em minutos (padrão: 60)',
            default: 60,
          },
        },
        required: ['cliente_nome', 'data', 'horario', 'tipo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancelar_agendamento',
      description: 'Cancela o último agendamento do cliente',
      parameters: {
        type: 'object',
        properties: {
          confirmar: {
            type: 'boolean',
            description: 'Confirmação do cancelamento',
          },
        },
        required: ['confirmar'],
      },
    },
  },
];

// ========== HANDLERS DAS FERRAMENTAS ==========

function parseBrazilDateTime(dateStr, timeStr) {
  // Tratamento de datas relativas
  const today = new Date();
  const brazilOffset = -3; // UTC-3
  
  // Ajustar para timezone do Brasil
  const brazilNow = new Date(today.getTime() + (brazilOffset * 60 * 60 * 1000));
  
  let day, month, year;
  
  // Detectar "amanhã", "hoje", etc.
  const lowerDate = dateStr.toLowerCase().trim();
  
  if (lowerDate.includes('amanhã') || lowerDate.includes('amanha')) {
    const tomorrow = new Date(brazilNow);
    tomorrow.setDate(tomorrow.getDate() + 1);
    day = tomorrow.getDate();
    month = tomorrow.getMonth() + 1;
    year = tomorrow.getFullYear();
    console.log(`📅 Detectado "amanhã" → ${day}/${month}/${year}`);
  } else if (lowerDate.includes('hoje')) {
    day = brazilNow.getDate();
    month = brazilNow.getMonth() + 1;
    year = brazilNow.getFullYear();
    console.log(`📅 Detectado "hoje" → ${day}/${month}/${year}`);
  } else {
    // Formato DD/MM ou DD/MM/AAAA
    const parts = dateStr.split('/').map(Number);
    day = parts[0];
    month = parts[1];
    year = parts[2] || new Date().getFullYear();
  }
  
  const [hour, minute] = timeStr.split(':').map(Number);
  
  console.log(`🕐 Parseando: ${day}/${month}/${year} ${hour}:${minute}`);
  
  // Criar data em UTC ajustando para Brasil (UTC-3)
  return new Date(Date.UTC(year, month - 1, day, hour + 3, minute, 0, 0));
}

async function handleVerificarDisponibilidade(args) {
  try {
    const { data, horario, tipo } = args;
    
    const start = parseBrazilDateTime(data, horario);
    const end = new Date(start.getTime() + 60 * 60000); // +1 hora
    
    // Validar horário de trabalho
    if (!isWithinWorkingHours(start) || !isWithinWorkingHours(end)) {
      return {
        disponivel: false,
        motivo: 'fora_expediente',
        mensagem: 'Este horário está fora do nosso expediente (8h às 18h, segunda a sexta).',
      };
    }
    
    // Verificar conflitos no banco
    const conflicts = await findConflicts(start, end, tipo);
    
    if (conflicts.length > 0) {
      return {
        disponivel: false,
        motivo: 'ocupado',
        mensagem: 'Este horário já está ocupado.',
        conflitos: conflicts.length,
      };
    }
    
    return {
      disponivel: true,
      mensagem: `O horário ${horario} do dia ${data} está disponível para ${tipo === 'online' ? 'reunião online' : 'visita à loja'}!`,
    };
  } catch (error) {
    console.error('❌ Erro ao verificar disponibilidade:', error);
    return {
      erro: true,
      mensagem: 'Erro ao verificar disponibilidade. Por favor, tente novamente.',
    };
  }
}

async function handleSugerirHorarios(args) {
  try {
    const { data, tipo } = args;
    
    // Usar meio-dia como referência para buscar horários disponíveis
    const referenceDate = parseBrazilDateTime(data, '12:00');
    
    const suggestions = await suggestAlternativeTimes(referenceDate, 60, { agendaType: tipo });
    
    if (suggestions.length === 0) {
      return {
        sugestoes: [],
        mensagem: 'Não encontrei horários disponíveis neste dia. Poderia tentar outro dia?',
      };
    }
    
    const formatted = suggestions.slice(0, 3).map(s => ({
      data: s.start.toLocaleDateString('pt-BR'),
      horario: s.start.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      fim: s.end.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    }));
    
    return {
      sugestoes: formatted,
      mensagem: `Encontrei ${formatted.length} horários disponíveis:`,
    };
  } catch (error) {
    console.error('❌ Erro ao sugerir horários:', error);
    return {
      erro: true,
      mensagem: 'Erro ao buscar horários. Por favor, tente novamente.',
    };
  }
}

async function handleCriarAgendamento(args, phoneNumber) {
  try {
    const { cliente_nome, data, horario, tipo, duracao = 60 } = args;
    
    const start = parseBrazilDateTime(data, horario);
    const end = new Date(start.getTime() + duracao * 60000);
    
    // Validar horário de trabalho
    if (!isWithinWorkingHours(start) || !isWithinWorkingHours(end)) {
      return {
        sucesso: false,
        mensagem: 'Este horário está fora do expediente (8h às 18h, seg a sex).',
      };
    }
    
    // Verificar conflitos
    const conflicts = await findConflicts(start, end, tipo);
    if (conflicts.length > 0) {
      // Sugerir alternativas
      const suggestions = await suggestAlternativeTimes(start, duracao, { agendaType: tipo });
      const formatted = suggestions.slice(0, 2).map(s => 
        `${s.start.toLocaleDateString('pt-BR')} às ${s.start.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
      ).join('\n• ');
      
      return {
        sucesso: false,
        mensagem: `Este horário não está mais disponível. Que tal um destes?\n\n• ${formatted}`,
      };
    }
    
    // Criar agendamento
    const summary = tipo === 'online' 
      ? `Atendimento - Reunião Online | ${cliente_nome}`
      : `Atendimento - Visita à Loja | ${cliente_nome}`;
    
    const description = `Cliente: ${cliente_nome}\nWhatsApp: ${phoneNumber}\nTipo: ${tipo === 'online' ? 'Reunião Online' : 'Visita à Loja'}`;
    
    console.log('📅 Criando evento no Google Calendar...');
    
    // 1. CRIAR NO GOOGLE CALENDAR PRIMEIRO
    let calendarEventId = null;
    let htmlLink = null;
    
    try {
      const { createCalendarEvent } = require('../config/google-calendar');
      const calendarEvent = await createCalendarEvent(
        summary,
        description,
        start,
        end,
        { agendaType: tipo, clientName: cliente_nome }
      );
      
      calendarEventId = calendarEvent.id;
      htmlLink = calendarEvent.htmlLink;
      
      console.log('✅ Evento criado no Google Calendar:', calendarEventId);
      console.log('🔗 Link:', htmlLink);
    } catch (calendarError) {
      console.error('⚠️ Erro ao criar no Google Calendar:', calendarError.message);
      console.log('💾 Continuando apenas com banco de dados...');
    }
    
    // 2. SALVAR NO BANCO
    await createAppointment({
      calendarEventId,
      summary,
      description,
      startTime: start,
      endTime: end,
      agendaType: tipo,
      clientName: cliente_nome,
      phoneNumber,
    });
    
    const dataFormatted = start.toLocaleDateString('pt-BR');
    const horaFormatted = start.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const tipoFormatted = tipo === 'online' ? 'Reunião online' : 'Visita à loja';
    
    let linkText = '';
    if (htmlLink) {
      linkText = `\n🔗 Link: ${htmlLink}`;
    }
    
    return {
      sucesso: true,
      mensagem: `✅ Agendamento confirmado!\n\n📅 ${tipoFormatted}\n🗓️ ${dataFormatted} às ${horaFormatted}\n👤 ${cliente_nome}${linkText}`,
      detalhes: {
        data: dataFormatted,
        horario: horaFormatted,
        tipo: tipoFormatted,
        calendarEventId,
        htmlLink,
      },
    };
  } catch (error) {
    console.error('❌ Erro ao criar agendamento:', error);
    return {
      sucesso: false,
      mensagem: 'Erro ao confirmar o agendamento. Por favor, tente novamente.',
    };
  }
}

async function handleCancelarAgendamento(phoneNumber) {
  try {
    const { findLatestByPhone } = require('../models/agendamento');
    const latest = await findLatestByPhone(phoneNumber);
    
    if (!latest) {
      return {
        sucesso: false,
        mensagem: 'Não encontrei nenhum agendamento ativo para cancelar.',
      };
    }
    
    // Remover do banco
    await pool.query('DELETE FROM appointments WHERE id = $1', [latest.id]);
    
    const start = new Date(latest.start_time);
    const dataFormatted = start.toLocaleDateString('pt-BR');
    const horaFormatted = start.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    
    return {
      sucesso: true,
      mensagem: `✅ Agendamento cancelado com sucesso!\n\n${latest.summary}\n📅 ${dataFormatted} às ${horaFormatted}`,
    };
  } catch (error) {
    console.error('❌ Erro ao cancelar agendamento:', error);
    return {
      sucesso: false,
      mensagem: 'Erro ao cancelar o agendamento. Por favor, tente novamente.',
    };
  }
}

// ========== PROCESSAMENTO DE FUNCTION CALLING ==========

async function processFunctionCalls(toolCalls, phoneNumber) {
  const results = [];
  
  for (const toolCall of toolCalls) {
    const functionName = toolCall.function.name;
    const args = JSON.parse(toolCall.function.arguments);
    
    console.log(`🔧 Executando ferramenta: ${functionName}`, args);
    
    let result;
    
    switch (functionName) {
      case 'verificar_disponibilidade':
        result = await handleVerificarDisponibilidade(args);
        break;
      case 'sugerir_horarios':
        result = await handleSugerirHorarios(args);
        break;
      case 'criar_agendamento':
        result = await handleCriarAgendamento(args, phoneNumber);
        break;
      case 'cancelar_agendamento':
        result = await handleCancelarAgendamento(phoneNumber);
        break;
      default:
        result = { erro: true, mensagem: 'Função não reconhecida' };
    }
    
    results.push({
      tool_call_id: toolCall.id,
      role: 'tool',
      name: functionName,
      content: JSON.stringify(result),
    });
  }
  
  return results;
}

// ========== GERAÇÃO DE RESPOSTA COM FUNCTION CALLING ==========

async function generateChatbotResponse(message, stateObj, contact, phoneNumber) {
  const { state, metadata } = stateObj;
  const customerName = contact.pushname || contact.name || 'Cliente';

  const systemPrompt = `
Você é **Maria**, assistente virtual da **Artestofados**, empresa especializada em fabricação, reforma e personalização de estofados em **João Pessoa - PB**. 🛋️

🎯 **PAPEL**
Atender clientes com simpatia, responder apenas perguntas **relacionadas à Artestofados**, e **executar as ferramentas** de agendamento quando necessário.

📌 **IMPORTANTE**
Você só deve responder mensagens que tenham relação com:
- produtos, serviços e preços da Artestofados
- fabricação, reforma ou personalização de estofados
- horários, orçamentos e agendamentos
- informações sobre localização, atendimento e contato da loja

❌ **SE O CLIENTE PERGUNTAR QUALQUER OUTRA COISA (fora da Artestofados)**:
- Responda educadamente que só pode ajudar com assuntos da Artestofados.
- Exemplo: "Posso te ajudar apenas com informações e serviços da Artestofados, tudo bem? 💙"

📅 **REGRAS DE AGENDAMENTO**

**VOCÊ TEM FERRAMENTAS DISPONÍVEIS - USE-AS SEMPRE!**

1. **VERIFICAR DISPONIBILIDADE**
   - Quando o cliente mencionar uma data/horário, chame IMEDIATAMENTE **"verificar_disponibilidade"**
   - Exemplo: Cliente diz "amanhã às 10h" → chame a ferramenta agora!
   - NÃO diga "vou verificar" — EXECUTE a verificação.

2. **CRIAR AGENDAMENTO**
   - Quando tiver: nome do cliente + data + horário + tipo (online/loja)
   - Chame IMEDIATAMENTE **"criar_agendamento"**
   - Aguarde o retorno da ferramenta para confirmar ao cliente.

3. **SUGERIR HORÁRIOS**
   - Se "verificar_disponibilidade" retornar ocupado
   - Chame automaticamente **"sugerir_horarios"**
   - NÃO invente horários — use sempre a ferramenta.

4. **FORMATO DE DATAS**
   - Aceite: "amanhã", "31/10", "31/10/2025"
   - Converta para DD/MM/AAAA antes de chamar a ferramenta
   - Ano atual: **2025**

5. **TIPOS DE AGENDAMENTO**
   - "online" → reunião virtual
   - "loja" → visita presencial

⚠️ **COMPORTAMENTO OBRIGATÓRIO**

❌ **NUNCA FAÇA ISSO:**
- “Vou verificar a disponibilidade” (sem chamar a ferramenta)
- “Vou criar seu agendamento” (sem chamar a ferramenta)
- Confirmar horários sem ter verificado
- Responder antes de receber o resultado da ferramenta

✅ **SEMPRE FAÇA ISSO:**
- Cliente menciona horário → chame **verificar_disponibilidade**
- Todos os dados prontos → chame **criar_agendamento**
- Horário ocupado → chame **sugerir_horarios**
- Espere o RESULTADO da ferramenta antes de responder.

💬 **TOM E PERSONALIDADE**
- Amigável, calorosa e empática 💙  
- Fale de forma simples e natural  
- Use emojis com moderação  
- Seja paciente, prestativa e sempre educada  
- Nunca discuta, apenas redirecione para o contexto da Artestofados

Exemplo de resposta fora do contexto:
> "Desculpe, posso te ajudar apenas com informações e serviços da Artestofados, tudo bem? 💙"

🧭 **FLUXO COMPLETO**

**EXEMPLO CORRETO:**

Cliente: "Quero agendar para amanhã às 10h"
Você: [CHAMA verificar_disponibilidade("31/10/2025", "10:00", "loja")]
[AGUARDA RESULTADO]
Resultado: {"disponivel": true}
Você: "Ótimo! Às 10h está livre. Qual seu nome completo?"
Cliente: "João Silva"
Você: [CHAMA criar_agendamento("João Silva", "31/10/2025", "10:00", "loja", 60)]
[AGUARDA RESULTADO]
Resultado: {"sucesso": true, "mensagem": "✅ Agendamento confirmado!..."}
Você: [REPETE a mensagem de confirmação do resultado]

**EXEMPLO INCORRETO:**

Cliente: "Quero agendar para amanhã às 10h"
Você: "Vou verificar a disponibilidade para você! Um momento." ❌
[NÃO CHAMOU A FERRAMENTA]

🏢 **INFORMAÇÕES**
- Endereço: Av. Almirante Barroso, 389, Centro – João Pessoa – PB
- Horário: Segunda a sexta, 8:00 às 18:00
- Ano atual: 2025

🔑 **LEMBRE-SE**
Você tem FERRAMENTAS poderosas. Quando souber o que fazer, EXECUTE imediatamente. Não avise que vai executar - EXECUTE!
`;

  const conversation = [{ role: 'system', content: systemPrompt }];

  if (metadata.history) {
    conversation.push(...metadata.history);
  }

  conversation.push({ role: 'user', content: message });

  try {
    console.log('🤖 Chamando OpenAI com Function Calling...');
    console.log('📝 Mensagem do usuário:', message);
    console.log('📊 Histórico:', metadata.history?.length || 0, 'mensagens');
    
    // Primeira chamada - pode retornar tool_calls
    let completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: conversation,
      tools: calendarTools,
      tool_choice: 'auto', // Deixar a IA decidir
      temperature: 0.7,
      max_tokens: 800,
    });

    let responseMessage = completion.choices[0].message;
    
    console.log('📨 Primeira resposta da IA:');
    console.log('  - Tem tool_calls?', !!responseMessage.tool_calls);
    console.log('  - Tem conteúdo?', !!responseMessage.content);
    console.log('  - Conteúdo:', responseMessage.content?.substring(0, 100));
    
    conversation.push(responseMessage);

    // Se há tool_calls, processar
    if (responseMessage.tool_calls) {
      console.log(`🔧 ${responseMessage.tool_calls.length} ferramenta(s) chamada(s):`);
      responseMessage.tool_calls.forEach(tc => {
        console.log(`   - ${tc.function.name}(${tc.function.arguments})`);
      });
      
      const toolResults = await processFunctionCalls(responseMessage.tool_calls, phoneNumber);
      
      console.log('📦 Resultados das ferramentas:');
      toolResults.forEach(tr => {
        console.log(`   - ${tr.name}: ${tr.content.substring(0, 100)}...`);
      });
      
      conversation.push(...toolResults);

      // Segunda chamada - com resultados das ferramentas
      console.log('🤖 Fazendo segunda chamada com resultados...');
      completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: conversation,
        temperature: 0.7,
        max_tokens: 800,
      });

      responseMessage = completion.choices[0].message;
      console.log('✅ Segunda resposta (final):', responseMessage.content?.substring(0, 100));
    } else {
      console.log('⚠️ Nenhuma ferramenta foi chamada na primeira resposta');
    }

    const response = responseMessage.content;
    
    if (!response) {
      console.error('❌ Resposta vazia da IA!');
      return {
        response: 'Desculpe, tive um problema ao processar sua mensagem. Pode repetir?',
        nextState: state,
        metadata,
      };
    }
    
    console.log('✅ Resposta final gerada:', response.substring(0, 100) + '...');

    // Atualizar histórico
    if (!metadata.history) metadata.history = [];
    metadata.history.push(
      { role: 'user', content: message },
      { role: 'assistant', content: response }
    );

    // Limitar histórico a 10 mensagens
    if (metadata.history.length > 20) {
      metadata.history = metadata.history.slice(-20);
    }

    if (!metadata.customerName && customerName !== 'Cliente') {
      metadata.customerName = customerName;
    }

    // Estado simplificado - deixar a IA gerenciar
    let nextState = state || 'conversando';

    return { response, nextState, metadata };
  } catch (error) {
    console.error('❌ Erro no OpenAI:', error);
    console.error('Stack:', error.stack);
    
    return {
      response: `Olá! 😊 Seja bem-vindo(a) à Artestofados!\n\nEstou com um probleminha técnico no momento, mas um atendente responderá em breve.\n\nComo posso ajudar você hoje?`,
      nextState: state,
      metadata,
    };
  }
}

// ========== RESTANTE DO CÓDIGO (manter funções existentes) ==========

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
    
    console.log('🧠 Generating chatbot response with Function Calling...');
    const response = await generateChatbotResponse(msg.body, state, contact, fromNumber);
    
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
    
    try {
      const chat = await client.getChatById(chatId);
      if (!chat) {
        console.error('❌ Chat not found:', chatId);
        throw new Error('Chat not found');
      }
    } catch (chatError) {
      console.error('❌ Error getting chat:', chatError.message);
    }
    
    await client.sendMessage(chatId, response);
    console.log('✅ Message sent successfully!');
  } catch (error) {
    console.error('❌ Error sending message:', error);
    
    if (error.message.includes('getChat') || error.message.includes('Evaluation failed')) {
      console.error('🔌 WhatsApp connection lost - marking as disconnected');
      status = 'disconnected';
      client = null;
    }
    
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