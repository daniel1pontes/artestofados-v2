const { Client, LocalAuth } = require('whatsapp-web.js');
const pool = require('../config/database');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// --- Imports Atualizados ---
// Assumindo que todas estas funções existem nos seus arquivos de config
const {
  createCalendarEvent,
  deleteCalendarEvent,
  updateCalendarEvent,
  checkTimeSlotAvailability, // Esta não está sendo usada diretamente nos handlers, mas `isWithinWorkingHours` e `suggestAlternativeTimes` sim
  suggestAlternativeTimes,
  isWithinWorkingHours,
  resolveCalendarId,
} = require('../config/google-calendar');

const {
  createAppointment,
  findConflicts,
  findLatestByPhone,
  updateAppointment,
} = require('../models/agendamento');
// -------------------------

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
let lastSendError = false;

// ========== FERRAMENTAS DO GOOGLE CALENDAR (ATUALIZADAS) ==========

const calendarTools = [
  // Ferramenta 1: Verificar Disponibilidade
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
            description: 'Data no formato DD/MM/AAAA (ou "hoje", "amanhã")',
          },
          horario: {
            type: 'string',
            description: 'Horário no formato HH:MM (ex: 14:00)',
          },
          tipo: {
            type: 'string',
            enum: ['online', 'visita'],
            description: 'Tipo de agendamento: online (reunião) ou visita (presencial)',
          },
          eventId: {
            type: 'string',
            description: 'Opcional: ID do evento (Google Calendar) para ignorar conflito com o próprio agendamento ao editar',
          },
        },
        required: ['data', 'horario', 'tipo'],
      },
    },
  },
  // Ferramenta 2: Sugerir Horários
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
            description: 'Data desejada no formato DD/MM/AAAA (ou "hoje", "amanhã")',
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
  // Ferramenta 3: Criar Agendamento
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
            description: 'Data do agendamento no formato DD/MM/AAAA (ou "hoje", "amanhã")',
          },
          horario: {
            type: 'string',
            description: 'Horário do agendamento no formato HH:MM',
          },
          tipo: {
            type: 'string',
            enum: ['online', 'visita'],
            description: 'Tipo: online (reunião) ou visita (presencial)',
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
  // Ferramenta 4: Buscar Último Agendamento (NOVA)
  {
    type: 'function',
    function: {
      name: 'buscar_ultimo_agendamento',
      description: 'Busca o último agendamento ativo do cliente. Essencial antes de editar ou cancelar.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  // Ferramenta 5: Editar Agendamento (NOVA)
  {
    type: 'function',
    function: {
      name: 'editar_agendamento',
      description: 'Altera um agendamento existente para uma nova data e/ou horário, após a disponibilidade ser confirmada.',
      parameters: {
        type: 'object',
        properties: {
          eventId: {
            type: 'string',
            description: "O ID do evento a ser modificado (obtido de 'buscar_ultimo_agendamento').",
          },
          nova_data: {
            type: 'string',
            description: 'A nova data no formato DD/MM/AAAA (ou "hoje", "amanhã").',
          },
          novo_horario: {
            type: 'string',
            description: 'O novo horário no formato HH:MM.',
          },
          duracao: {
            type: 'number',
            description: 'Duração em minutos (padrão 60).',
            default: 60,
          },
        },
        required: ['eventId', 'nova_data', 'novo_horario'],
      },
    },
  },
  // Ferramenta 6: Cancelar Agendamento (Lógica alterada no handler)
  {
    type: 'function',
    function: {
      name: 'cancelar_agendamento',
      description: 'Cancela o último agendamento do cliente (requer confirmação prévia da IA)',
      parameters: {
        type: 'object',
        properties: {
          confirmar: {
            type: 'boolean',
            description: 'Confirmação (true) de que o cliente deseja cancelar. A IA deve obter essa confirmação antes de chamar a ferramenta.',
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
  // Obtém a data/hora *atual* no fuso de São Paulo (BRT/UTC-3)
  const brazilNow = new Date(today.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  
  let day, month, year;
  const lowerDate = dateStr.toLowerCase().trim();

  if (lowerDate.includes('amanhã') || lowerDate.includes('amanha')) {
    const tomorrow = new Date(brazilNow);
    tomorrow.setDate(tomorrow.getDate() + 1);
    day = tomorrow.getDate();
    month = tomorrow.getMonth() + 1; // Meses são 0-11
    year = tomorrow.getFullYear();
    console.log(`📅 Detectado "amanhã" → ${day}/${month}/${year}`);
  } else if (lowerDate.includes('hoje')) {
    day = brazilNow.getDate();
    month = brazilNow.getMonth() + 1; // Meses são 0-11
    year = brazilNow.getFullYear();
    console.log(`📅 Detectado "hoje" → ${day}/${month}/${year}`);
  } else {
    // Formato DD/MM ou DD/MM/AAAA
    const parts = dateStr.split('/').map(Number);
    if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) {
        throw new Error("Formato de data inválido. Use DD/MM/AAAA ou DD/MM.");
    }
    day = parts[0];
    month = parts[1];
    year = parts[2] || brazilNow.getFullYear();
    
    // Se o ano for 2 dígitos (ex: 25), assume 2025
    if (year < 100) {
        year += 2000;
    }
    
    // Se a data/mês for no passado este ano (e não foi fornecido ano), assume próximo ano
    // Ex: hoje é 30/10/2025, usuário digita 15/01 -> assume 15/01/2026
    const parsedDateForYearCheck = new Date(year, month - 1, day);
    // Compara apenas a data, ignorando a hora
    const todayDateOnly = new Date(brazilNow.getFullYear(), brazilNow.getMonth(), brazilNow.getDate());
    
    if (parsedDateForYearCheck < todayDateOnly && parts.length === 2) {
        year += 1;
        console.log(`📅 Data no passado, assumindo próximo ano: ${year}`);
    }
  }

  // Normalizar horário: aceitar "12h", "12", "12:00", "12h30"
  let hour, minute;
  if (typeof timeStr === 'string') {
    const trimmed = timeStr.trim().toLowerCase();
    // Tentar capturar HH e MM opcionais (12h30, 12:30, 12h, 12)
    const m = trimmed.match(/^(\d{1,2})(?:[:hH\s]?(\d{1,2}))?$/);
    if (m) {
      hour = parseInt(m[1], 10);
      minute = m[2] !== undefined ? parseInt(m[2], 10) : 0;
    }
  }
  if (isNaN(hour) || isNaN(minute)) {
    throw new Error("Formato de horário inválido. Use HH:MM (ex: 14:00) ou '12h'/'12'.");
  }

  console.log(`🕐 Parseando: ${day}/${month}/${year} ${hour}:${minute} (Horário de Brasília)`);

  // O Google Calendar API espera datas em UTC (formato ISO 8601).
  // Criamos a data como se fosse UTC, mas com a hora de Brasília.
  // O fuso de Brasília é UTC-3. Então, 10:00 BRL = 13:00 UTC.
  // A função Date.UTC trata os argumentos como UTC.
  const utcDate = new Date(Date.UTC(year, month - 1, day, hour + 3, minute, 0, 0));
  
  if (isNaN(utcDate.getTime())) {
      throw new Error(`Data/hora inválida: ${day}/${month}/${year} ${hour}:${minute}`);
  }

  console.log(`🌎 Data UTC gerada: ${utcDate.toISOString()}`);
  return utcDate;
}

async function handleVerificarDisponibilidade(args) {
  try {
    const { data, horario, tipo, eventId } = args;
    
    const start = parseBrazilDateTime(data, horario);
    const end = new Date(start.getTime() + 60 * 60000); // +1 hora
    
    // Validar horário de trabalho (isWithinWorkingHours deve receber a data UTC)
    if (!isWithinWorkingHours(start) || !isWithinWorkingHours(end)) {
      return {
        disponivel: false,
        motivo: 'fora_expediente',
        mensagem: 'Este horário está fora do nosso expediente (8h às 18h, segunda a sexta).',
      };
    }
    
    // Verificar conflitos no banco
    let conflicts = await findConflicts(start, end, tipo);
    // Ignorar conflito com o próprio evento (quando em edição)
    if (eventId) {
      conflicts = conflicts.filter(c => c.calendar_event_id !== eventId);
    }
    
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
      mensagem: `O horário ${horario} do dia ${data} está disponível para ${tipo === 'online' ? 'reunião online' : 'visita'}!`,
    };
  } catch (error) {
    console.error('❌ Erro ao verificar disponibilidade:', error);
    return {
      erro: true,
      mensagem: `Erro ao verificar disponibilidade: ${error.message}. Por favor, peça para o cliente tentar novamente.`,
    };
  }
}

async function handleSugerirHorarios(args) {
  try {
    const { data, tipo } = args;
    
    // Usar meio-dia como referência para buscar horários disponíveis
    const referenceDate = parseBrazilDateTime(data, '12:00');
    
    // suggestAlternativeTimes deve retornar datas UTC
    const suggestions = await suggestAlternativeTimes(referenceDate, 60, { agendaType: tipo });
    
    if (suggestions.length === 0) {
      return {
        sugestoes: [],
        mensagem: 'Não encontrei horários disponíveis neste dia. Poderia tentar outro dia?',
      };
    }
    
    // Formatar as sugestões de volta para o fuso de Brasília para o usuário
    const formatted = suggestions.slice(0, 3).map(s => ({
      data: s.start.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      horario: s.start.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }),
      fim: s.end.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }),
    }));
    
    return {
      sugestoes: formatted,
      mensagem: `Encontrei ${formatted.length} horários disponíveis:`,
    };
  } catch (error) {
    console.error('❌ Erro ao sugerir horários:', error);
    return {
      erro: true,
      mensagem: `Erro ao buscar horários: ${error.message}. Por favor, tente novamente.`,
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
      // Não sugerir automaticamente – pedir o melhor horário ao cliente
      return {
        sucesso: false,
        mensagem: 'Este horário não está mais disponível. Poderia me informar o melhor horário para você dentro do nosso expediente (08:00–18:00, seg a sex)?',
      };
    }
    
    // Criar agendamento
    const summary = tipo === 'online' 
      ? `Atendimento - Reunião Online | ${cliente_nome}`
      : `Atendimento - Visita | ${cliente_nome}`;
    
    const description = `Cliente: ${cliente_nome}\nWhatsApp: ${phoneNumber}\nTipo: ${tipo === 'online' ? 'Reunião Online' : 'Visita à Loja'}`;
    
    console.log('📅 Criando evento no Google Calendar...');
    
    // 1. CRIAR NO GOOGLE CALENDAR PRIMEIRO
    let calendarEventId = null;
    let htmlLink = null;
    
    try {
      // `start` e `end` já estão em UTC, corretos para a API
      const calendarEvent = await createCalendarEvent(
        summary,
        description,
        start,
        end,
        { agendaType: tipo, clientName: cliente_nome, calendarId: resolveCalendarId({ agendaType: tipo }) }
      );
      
      calendarEventId = calendarEvent.id;
      htmlLink = calendarEvent.htmlLink;
      
      console.log('✅ Evento criado no Google Calendar:', calendarEventId);
      console.log('🔗 Link:', htmlLink);
    } catch (calendarError) {
      console.error('⚠️ Erro ao criar no Google Calendar:', calendarError.message);
      // Parar a execução se o Google Calendar falhar é uma boa prática
      return {
        sucesso: false,
        mensagem: `Tive um problema ao tentar agendar no Google Calendar: ${calendarError.message}. Não posso continuar com o agendamento.`,
      };
    }
    
    // 2. SALVAR NO BANCO
    // Salvar a data UTC no banco
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
    console.log('✅ Evento salvo no banco de dados local.');

    
    // Formatar a data/hora de volta para Brasília para exibir ao usuário
    const dataFormatted = start.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const horaFormatted = start.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
    const tipoFormatted = tipo === 'online' ? 'Reunião online' : 'Visita';
    
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
      mensagem: `Erro ao confirmar o agendamento: ${error.message}.`,
    };
  }
}

// NOVO HANDLER
async function handleBuscarUltimoAgendamento(args, phoneNumber) {
  try {
    const latest = await findLatestByPhone(phoneNumber);
    
    if (!latest) {
      return {
        sucesso: false,
        mensagem: 'Não encontrei nenhum agendamento ativo em seu nome.',
      };
    }

    // `latest.start_time` vem do banco (assumindo estar em UTC)
    const start = new Date(latest.start_time);
    const dataFormatted = start.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const horaFormatted = start.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

    return {
      sucesso: true,
      mensagem: 'Encontrei este agendamento:',
      evento: {
        id: latest.calendar_event_id, // ID do Google Calendar
        summary: latest.summary,
        data: dataFormatted,
        horario: horaFormatted,
        tipo: latest.agenda_type,
        db_id: latest.id, // ID do banco de dados local
      },
    };
  } catch (error) {
    console.error('❌ Erro ao buscar último agendamento:', error);
    return {
      sucesso: false,
      mensagem: `Erro ao buscar seu agendamento: ${error.message}.`,
    };
  }
}

// NOVO HANDLER
async function handleEditarAgendamento(args, phoneNumber) {
  try {
    const { eventId, nova_data, novo_horario, duracao = 60 } = args;

    // 1. Buscar dados atuais do evento (tipo, nome, etc.) pelo ID do DB
    // Usamos o eventId do Google para garantir que estamos editando o correto
    const result = await pool.query('SELECT * FROM appointments WHERE calendar_event_id = $1 AND phone_number = $2', [eventId, phoneNumber]);

    if (result.rows.length === 0) {
       return { 
            sucesso: false, 
            mensagem: 'Não consegui encontrar o agendamento original para editar. Por favor, tente cancelar e agendar novamente.'
        };
    }
    
    const latest = result.rows[0];
    const tipo = latest.agenda_type;
    const cliente_nome = latest.client_name;

    // 2. Validar novo horário
    const start = parseBrazilDateTime(nova_data, novo_horario);
    const end = new Date(start.getTime() + duracao * 60000);

    if (!isWithinWorkingHours(start) || !isWithinWorkingHours(end)) {
      return {
        sucesso: false,
        mensagem: 'O novo horário está fora do expediente (8h às 18h, seg a sex).',
      };
    }

    // 3. Verificar conflitos
    const conflicts = await findConflicts(start, end, tipo);
    if (conflicts.length > 0) {
        // Ignorar conflito se for o próprio evento que estamos editando
        // Se houver mais de 1 conflito, ou se o conflito for com um ID *diferente*
        if (conflicts.length > 1 || conflicts[0].calendar_event_id !== eventId) {
             return {
                sucesso: false,
                mensagem: 'Este novo horário já está ocupado por outro cliente.',
            };
        }
        console.log(`ℹ️ Conflito encontrado é com o próprio evento (${eventId}). Ignorando.`);
    }

    // 4. Atualizar no Google Calendar
    const summary = tipo === 'online' 
      ? `Atendimento - Reunião Online | ${cliente_nome}`
      : `Atendimento - Visita à Loja | ${cliente_nome}`;
    
    const description = `Cliente: ${cliente_nome}\nWhatsApp: ${phoneNumber}\nTipo: ${tipo === 'online' ? 'Reunião Online' : 'Visita à Loja'}\n(EVENTO REAGENDADO)`;

    console.log(`🔄 Atualizando evento no Google Calendar: ${eventId}`);
    
    let htmlLink = null;
    try {
        // `start` e `end` estão em UTC
        const updatedEvent = await updateCalendarEvent(
            eventId,
            summary,
            description,
            start,
            end,
            { agendaType: tipo, clientName: cliente_nome, calendarId: resolveCalendarId({ agendaType: tipo }) }
        );
        htmlLink = updatedEvent.htmlLink;
        console.log('✅ Evento atualizado no Google Calendar');
    } catch (calendarError) {
        console.error('⚠️ Erro ao ATUALIZAR no Google Calendar:', calendarError.message);
        return {
            sucesso: false,
            mensagem: `Tive um problema ao tentar reagendar no Google Calendar: ${calendarError.message}. O agendamento antigo foi mantido.`,
        };
    }
    
    // 5. Atualizar no Banco de Dados Local
    // Salvar as datas UTC atualizadas
    await updateAppointment(latest.id, {
      summary,
      description,
      startTime: start,
      endTime: end,
    });
    console.log('✅ Evento atualizado no banco de dados local');

    // Formatar para Brasília para exibir ao usuário
    const dataFormatted = start.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const horaFormatted = start.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

    return {
      sucesso: true,
      mensagem: `✅ Agendamento reagendado com sucesso!\n\nNovo horário: ${dataFormatted} às ${horaFormatted}\n🔗 Link: ${htmlLink || '(link não alterado)'}`,
    };
  } catch (error) {
    console.error('❌ Erro ao editar agendamento:', error);
    return {
      sucesso: false,
      mensagem: `Erro ao reagendar: ${error.message}.`,
    };
  }
}

// HANDLER MODIFICADO
async function handleCancelarAgendamento(args, phoneNumber) {
  // O argumento 'confirmar' é apenas para a IA garantir que o usuário confirmou.
  if (!args.confirmar) {
      return {
          sucesso: false,
          mensagem: "O cancelamento não foi confirmado pela IA."
      }
  }

  try {
    const latest = await findLatestByPhone(phoneNumber);
    
    if (!latest) {
      return {
        sucesso: false,
        mensagem: 'Não encontrei nenhum agendamento ativo para cancelar.',
      };
    }
    
    // 1. Remover do Google Calendar
    if (latest.calendar_event_id) {
      console.log(`🗑️ Deletando evento do Google Calendar: ${latest.calendar_event_id}`);
      try {
        const tipo = latest.agenda_type;
        const calendarId = resolveCalendarId({ agendaType: tipo });
        await deleteCalendarEvent(latest.calendar_event_id, { agendaType: tipo, calendarId });
        console.log('✅ Evento deletado do Google Calendar');
      } catch (calendarError) {
        console.error('⚠️ Erro ao DELETAR do Google Calendar:', calendarError.message);
        // Não parar o processo, apenas logar. O mais importante é liberar o slot no DB local.
        // Pode ser que o evento já tenha sido deletado manualmente no GCalendar.
      }
    } else {
      console.log('⚠️ Agendamento local não tinha ID do Google Calendar. Removendo apenas localmente.');
    }

    // 2. Remover do banco de dados local
    await pool.query('DELETE FROM appointments WHERE id = $1', [latest.id]);
    console.log('✅ Evento deletado do banco de dados local');
    
    // Formatar data/hora (que estava em UTC) para Brasília
    const start = new Date(latest.start_time);
    const dataFormatted = start.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const horaFormatted = start.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
    
    return {
      sucesso: true,
      mensagem: `✅ Agendamento cancelado com sucesso!\n\n${latest.summary}\n📅 ${dataFormatted} às ${horaFormatted}`,
    };
  } catch (error) {
    console.error('❌ Erro ao cancelar agendamento:', error);
    return {
      sucesso: false,
      mensagem: `Erro ao cancelar o agendamento: ${error.message}.`,
    };
  }
}

// ========== PROCESSAMENTO DE FUNCTION CALLING (ATUALIZADO) ==========

async function processFunctionCalls(toolCalls, phoneNumber) {
  const results = [];
  
  for (const toolCall of toolCalls) {
    const functionName = toolCall.function.name;
    let args;
    try {
        args = JSON.parse(toolCall.function.arguments);
    } catch (error) {
        console.error(`❌ Erro ao parsear argumentos para ${functionName}: ${toolCall.function.arguments}`);
        results.push({
            tool_call_id: toolCall.id,
            role: 'tool',
            name: functionName,
            content: JSON.stringify({ erro: true, mensagem: `Erro interno: Argumentos da função malformados. ${error.message}` }),
        });
        continue; // Pula para a próxima toolCall
    }

    
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
      case 'buscar_ultimo_agendamento': // NOVO
        result = await handleBuscarUltimoAgendamento(args, phoneNumber);
        break;
      case 'editar_agendamento': // NOVO
        result = await handleEditarAgendamento(args, phoneNumber);
        break;
      case 'cancelar_agendamento': // Modificado
        result = await handleCancelarAgendamento(args, phoneNumber);
        break;
      default:
        result = { erro: true, mensagem: `Função desconhecida: ${functionName}` };
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

// ========== GERAÇÃO DE RESPOSTA COM FUNCTION CALLING (PROMPT ATUALIZADO) ==========

async function generateChatbotResponse(message, stateObj, contact, phoneNumber) {
  const { state, metadata } = stateObj;
  const customerName = contact.pushname || contact.name || 'Cliente';
  const dataAtual = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const anoAtual = new Date().getFullYear();

  const systemPrompt = `
Você é *Maria*, assistente virtual da **Artestofados**, empresa especializada em fabricação, reforma e personalização de estofados em *João Pessoa - PB*. 🛋️

Data de hoje: ${dataAtual}
Ano atual: ${anoAtual}

🎯 PAPEL
Atender clientes com simpatia, responder perguntas relacionadas à Artestofados, e executar as ferramentas de agendamento (criar, editar, cancelar) de forma precisa.

📌 IMPORTANTE
Foque em assuntos como:
- produtos, serviços e preços da Artestofados
- fabricação, reforma ou personalização de estofados
- horários, orçamentos e agendamentos
- informações sobre localização, atendimento e contato da loja

Se o cliente falar de algo fora desses temas, não recuse. Responda brevemente e redirecione com simpatia para nossos serviços, por exemplo:
"Entendi! 😊 Eu ajudo com fabricação e reforma de estofados aqui na Artestofados. Posso te orientar sobre projetos, orçamentos e agendamentos. Como posso te ajudar com seu estofado hoje?"

---

🏁 FLUXO DE ATENDIMENTO PADRÃO
(antes de iniciar qualquer agendamento, siga essa sequência)
---

1️⃣ **Boas-vindas**
Cumprimente o cliente e pergunte o nome:
> "Olá! 😊 Seja bem-vindo(a) à Artestofados, especialista em fabricação e reforma de estofados em João Pessoa. Posso saber seu nome, por favor?"

2️⃣ **Identificar necessidade**
Depois do nome:
> "Perfeito, [nome]! Você gostaria de *fabricar um novo estofado* ou *reformar um estofado existente*?"

3️⃣ **Se o cliente quiser REFORMA**
> "Ótimo, [nome]! Por gentileza, envie algumas fotos do estofado que deseja reformar para que nossa equipe possa analisar. Assim que possível, retornaremos com o orçamento e orientações, tudo bem?"
➡️ Após isso, agradeça e encerre:
> "Agradeço seu contato com a Artestofados! 💙 Assim que nossa equipe avaliar as fotos, retornaremos com os detalhes."

4️⃣ **Se o cliente quiser FABRICAÇÃO**
> "Perfeito, [nome]! Qual tipo de estofado você gostaria de fabricar? Temos opções como *sofá, poltrona, cadeira ou cama*."

5️⃣ **Perguntar sobre projeto**
Após o cliente informar o tipo:
> "Você já possui um projeto ou referência do estofado que deseja? 📐"

- Se **tiver projeto**:
  > "Excelente! Podemos agendar uma *reunião online* ou *visita à nossa loja* para discutir os detalhes. Qual opção você prefere?"

- Se **não tiver projeto**:
  > "Sem problema! Podemos conversar melhor para entender seu estilo e criar algo sob medida. 😊 Prefere uma *visita à loja* ou *reunião online*?"

6️⃣ **Agendamento**
Após o cliente escolher o tipo de atendimento, pergunte:
> "Qual seria o melhor dia e horário para você (DD/MM/AAAA e HH:MM)?"

📅 Utilize as ferramentas de agendamento (descritas abaixo):
- 'verificar_disponibilidade'
- 'criar_agendamento'
- 'sugerir_horarios'
- 'buscar_ultimo_agendamento'
- 'editar_agendamento'
- 'cancelar_agendamento'

7️⃣ **Confirmação**
Depois da criação bem-sucedida:
> "Perfeito, [nome]! Seu agendamento foi confirmado para [data e hora]. Estaremos prontos para conversar sobre seu projeto. 💙"

8️⃣ **Encerramento**
Finalize com simpatia:
> "Obrigada por escolher a Artestofados! Ficamos muito felizes em atender você. Até breve! 🛋️✨"

---

📅 REGRAS DE AGENDAMENTO (MANTIDAS)
---

➡️ **FLUXO 1: CRIAR NOVO AGENDAMENTO**
1. Cliente pede para agendar ou menciona data/hora.  
2. Chame 'verificar_disponibilidade' com a data, hora e tipo.  
3. [AGUARDE O RESULTADO]  
4. Se disponível: pergunte o nome completo do cliente (se ainda não souber).  
5. Com NOME, DATA, HORA e TIPO, chame 'criar_agendamento'.  
6. [AGUARDE O RESULTADO]  
7. Se ocupado: explique que o horário não está disponível e pergunte qual seria o melhor horário para o cliente dentro do expediente (08:00–18:00).  
8. Repasse a mensagem de sucesso ou erro da ferramenta exatamente como veio.

➡️ **FLUXO 2: EDITAR/REMARCAR AGENDAMENTO**
1. Cliente pede para "editar", "remarcar" ou "alterar".  
2. Chame 'buscar_ultimo_agendamento'.  
3. [AGUARDE O RESULTADO]  
4. Mostre o agendamento e pergunte nova data/hora.  
5. Verifique disponibilidade ('verificar_disponibilidade'), passando o 'eventId' do agendamento atual para ignorar conflito consigo mesmo.  
6. Se disponível: chame 'editar_agendamento'.  
7. Se ocupado: pergunte qual seria o melhor horário para o cliente dentro do expediente (08:00–18:00).  

➡️ **FLUXO 3: CANCELAR AGENDAMENTO**
1. Cliente pede para "cancelar".  
2. Chame 'buscar_ultimo_agendamento'.  
3. Mostre o agendamento encontrado e peça confirmação.  
4. Se confirmar, chame 'cancelar_agendamento({ confirmar: true })'.  
5. Repasse a mensagem de sucesso ou erro.

---

⚠️ **FORMATO DE DATAS E HORÁRIOS**
- Aceite “hoje” e “amanhã” (as ferramentas entendem).  
- Se o cliente disser “sexta-feira” ou “dia 30”, peça:  
  > “Por favor, me informe a data completa (DD/MM/AAAA) e o horário (HH:MM).”

---

🏢 **INFORMAÇÕES**
Endereço: Av. Almirante Barroso, 389, Centro – João Pessoa – PB  
Horário: Segunda a sexta, 08:00 às 18:00
`;
;

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
      model: 'gpt-4o-mini', // Recomendo usar um modelo mais robusto se possível, como gpt-4o
      messages: conversation,
      tools: calendarTools,
      tool_choice: 'auto', // Deixar a IA decidir
      temperature: 0.2, // Baixa temperatura para seguir regras
      max_tokens: 800,
    });

    let responseMessage = completion.choices[0].message;
    
    console.log('📨 Primeira resposta da IA:');
    console.log('  - Tem tool_calls?', !!responseMessage.tool_calls);
    console.log('  - Tem conteúdo?', !!responseMessage.content);
    console.log('  - Conteúdo:', responseMessage.content?.substring(0, 100));
    
    conversation.push(responseMessage);

    // Se a IA respondeu sem usar ferramentas, e a mensagem do usuário sugere intenção de agendar/sugerir/editar/cancelar,
    // forçar uma segunda chamada com instrução mais rígida para usar as tools.
    const schedulingIntent = /agend|remarc|edit|cancel|hor[áa]rio|dispon[ií]vel|sugerir|sugest[ãa]o|amanh[ãa]|hoje|dia \d{1,2}/i;
    if (!responseMessage.tool_calls && schedulingIntent.test(message)) {
      const strictReminder = {
        role: 'system',
        content: 'ATENÇÃO: Para qualquer verificação de disponibilidade, sugestão de horários, criação, edição ou cancelamento de agendamentos, VOCÊ DEVE usar exclusivamente as ferramentas fornecer. NUNCA invente horários ou declare disponibilidade manualmente. Somente responda após usar as tools correspondentes.'
      };
      conversation.push(strictReminder);
      console.log('⚖️ Reforçando uso de ferramentas e refazendo chamada...');

      completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: conversation,
        tools: calendarTools,
        tool_choice: 'auto',
        temperature: 0.2,
        max_tokens: 800,
      });
      responseMessage = completion.choices[0].message;
      conversation.push(responseMessage);
    }

    // Loop para processar múltiplos tool_calls se necessário (embora 'auto' geralmente chame um de cada vez)
    while (responseMessage.tool_calls) {
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

      // Próxima chamada - com resultados das ferramentas
      console.log('🤖 Fazendo próxima chamada com resultados...');
      completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: conversation,
        tools: calendarTools,
        tool_choice: 'auto',
        temperature: 0.2,
        max_tokens: 800,
      });

      responseMessage = completion.choices[0].message;
      console.log('📨 Próxima resposta da IA:');
      console.log('  - Tem tool_calls?', !!responseMessage.tool_calls);
      console.log('  - Conteúdo (final?):', responseMessage.content?.substring(0, 100));
      
      conversation.push(responseMessage);
    } 

    const response = responseMessage.content;
    
    if (!response) {
      console.error('❌ Resposta vazia da IA após processar ferramentas!');
      return {
        response: 'Desculpe, tive um problema ao processar sua mensagem. Pode repetir?',
        nextState: state,
        metadata,
      };
    }
    
    console.log('✅ Resposta final gerada:', response.substring(0, 100) + '...');

    // Atualizar histórico (apenas a resposta final da IA)
    if (!metadata.history) metadata.history = [];
    
    // Limpar histórico antigo se ficar muito grande
    if (metadata.history.length > 20) {
      metadata.history = metadata.history.slice(-20);
    }
    
    // Adicionar a última interação (pergunta do usuário + resposta final da IA)
    metadata.history.push(
      { role: 'user', content: message },
      { role: 'assistant', content: response } 
    );


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
      response: `Olá! 😊 Seja bem-vindo(a) à Artestofados!\n\nEstou com um probleminha técnico no momento (${error.message}), mas um atendente responderá em breve.\n\nComo posso ajudar você hoje?`,
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

  // When a message is created from this account (manual human reply via phone/WA Web),
  // pause bot for that specific chat so it doesn't interfere
  client.on('message_create', async (msg) => {
    try {
      // Ignore messages not from this account
      if (!msg.fromMe) return;

      const chat = await msg.getChat();
      if (chat.isGroup) return;

      // For 1:1 chats, the other participant's number
      const otherId = chat.id.user; // e.g., '5511999999999'
      if (!otherId) return;

      console.log(`👤 Human replied in chat ${otherId} - auto-pausing for 2 hours`);
      pauseChat(otherId, 2);
    } catch (err) {
      console.error('❌ Error in message_create handler:', err);
    }
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
  // console.log('👥 Employee numbers configured:', employees); // Opcional: remover para logs mais limpos
  // console.log('🔍 Checking number:', number, '- Result:', isEmployee); // Opcional: remover para logs mais limpos
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
    const tsDate = new Date(tsMs); // Deixamos isso aqui, embora não seja mais usado na query
    await pool.query(
      `INSERT INTO messages (id, from_number, body, timestamp, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [messageId, fromNumber, body, tsMs] // CORREÇÃO: Passar tsMs (bigint) em vez de tsDate (Date object)
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
    
    if (status === 'connected' && client && !lastSendError) {
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
    lastSendError = false;
    const chatId = phoneNumber.includes('@c.us') 
      ? phoneNumber 
      : `${phoneNumber}@c.us`;
    
    // console.log('📤 Sending to:', chatId); // Opcional: remover para logs mais limpos
    console.log('💬 Message preview:', response.substring(0, 50) + '...');
    
    // Remover verificação de chat, pois às vezes falha e não é essencial
    // try {
    //   const chat = await client.getChatById(chatId);
    //   if (!chat) {
    //     console.error('❌ Chat not found:', chatId);
    //     throw new Error('Chat not found');
    //   }
    // } catch (chatError) {
    //   console.error('❌ Error getting chat:', chatError.message);
    // }
    
    await client.sendMessage(chatId, response);
    console.log('✅ Message sent successfully!');
  } catch (error) {
    console.error('❌ Error sending message:', error);
    lastSendError = true;
    
    if (error.message.includes('getChat') || error.message.includes('Evaluation failed') || error.message.includes('protocol error')) {
      console.error('🔌 WhatsApp connection likely lost - marking as disconnected');
      status = 'disconnected';
      qrString = ''; // Forçar novo QR
      if (client) {
        client.destroy().catch(err => console.error('Error destroying client after send fail:', err));
      }
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
      console.log('▶️ Global pause expired, resuming bot');
      pausedUntil = null;
    } else {
      return true;
    }
  }

  if (phoneNumber && chatPauses.has(phoneNumber)) {
    const chatPauseUntil = chatPauses.get(phoneNumber);
    if (Date.now() > chatPauseUntil.getTime()) {
      console.log(`▶️ Chat pause expired for ${phoneNumber}, resuming`);
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