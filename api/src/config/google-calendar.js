const { google } = require('googleapis');
const path = require('path');

let authClient = null;

// Configurações de horário de trabalho (08:00 às 18:00, segunda a sexta)
const WORK_HOURS = {
  start: 8,
  startMinutes: 0,
  end: 18,
  endMinutes: 0,
  workingDays: [1, 2, 3, 4, 5]
};

// Duração padrão das reuniões (1 hora)
const DEFAULT_MEETING_DURATION = 60; // em minutos

// Mapeamento de agendas paralelas
// Defina as variáveis de ambiente:
//  - GOOGLE_CALENDAR_ID_ONLINE
//  - GOOGLE_CALENDAR_ID_LOJA
// Caso não definidas, usa 'primary'
function getCalendarIdByType(agendaType) {
  const normalized = String(agendaType || '').toLowerCase();
  if (normalized === 'online') return process.env.GOOGLE_CALENDAR_ID_ONLINE || 'primary';
  if (normalized === 'loja' || normalized === 'visita' || normalized === 'presencial') {
    return process.env.GOOGLE_CALENDAR_ID_LOJA || 'primary';
  }
  return 'primary';
}

// Resolve o calendarId com a seguinte prioridade:
// 1) options.calendarId
// 2) process.env.CALENDAR_ID ou process.env.GOOGLE_CALENDAR_ID
// 3) Mapeamento por tipo (online/loja) via getCalendarIdByType
function resolveCalendarId(options = {}) {
  if (options.calendarId) return options.calendarId;
  if (process.env.CALENDAR_ID) return process.env.CALENDAR_ID;
  if (process.env.GOOGLE_CALENDAR_ID) return process.env.GOOGLE_CALENDAR_ID;
  return getCalendarIdByType(options.agendaType);
}

// Helpers para tratar datas no fuso de São Paulo
function getBrazilYMD(date) {
  const fmt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = fmt.formatToParts(date);
  const d = parseInt(parts.find(p => p.type === 'day').value, 10);
  const m = parseInt(parts.find(p => p.type === 'month').value, 10);
  const y = parseInt(parts.find(p => p.type === 'year').value, 10);
  return { y, m, d };
}

// Constrói uma Date em UTC correspondente a um horário em BRT (UTC-3)
function makeUtcFromBrazil(y, m, d, hour, minute) {
  // America/Sao_Paulo atualmente UTC-3; se houver mudança de DST no futuro, troque para cálculo dinâmico
  const UTC_OFFSET = 3; // horas a somar para ir de BRT -> UTC
  return new Date(Date.UTC(y, m - 1, d, hour + UTC_OFFSET, minute, 0, 0));
}

async function getAuthClient() {
  if (authClient) return authClient;

  let keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyPath) {
    // Fallback para o caminho padrão dentro do projeto: api/credentials/google-service-account.json
    const fallback = path.resolve(__dirname, '../../credentials/google-service-account.json');
    keyPath = fallback;
    console.warn(`⚠️ GOOGLE_SERVICE_ACCOUNT_KEY não configurado. Tentando fallback: ${fallback}`);
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: keyPath,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });

  // 🔥 Pega o client autenticado de fato
  authClient = await auth.getClient();
  return authClient;
}

// Função para verificar se um horário está dentro do horário de trabalho baseado em America/Sao_Paulo
function isWithinWorkingHours(dateTime) {
  const date = new Date(dateTime);
  const fmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const parts = fmt.formatToParts(date);
  const hourPart = parts.find(p => p.type === 'hour');
  const minutePart = parts.find(p => p.type === 'minute');
  const weekdayPart = parts.find(p => p.type === 'weekday');
  const hour = hourPart ? parseInt(hourPart.value, 10) : date.getUTCHours();
  const minute = minutePart ? parseInt(minutePart.value, 10) : date.getUTCMinutes();
  const weekdayMap = { 'dom': 0, 'seg': 1, 'ter': 2, 'qua': 3, 'qui': 4, 'sex': 5, 'sáb': 6, 'sab': 6 };
  const dow = weekdayPart ? weekdayMap[(weekdayPart.value || '').toLowerCase()] : date.getUTCDay();

  const currentMinutes = hour * 60 + minute;
  const startMinutes = (WORK_HOURS.start * 60) + (WORK_HOURS.startMinutes || 0);
  const endMinutes = (WORK_HOURS.end * 60) + (WORK_HOURS.endMinutes || 0);

  return WORK_HOURS.workingDays.includes(dow) && currentMinutes >= startMinutes && currentMinutes < endMinutes;
}

// Função para verificar conflitos de horário
async function checkTimeSlotAvailability(startTime, endTime, options = {}) {
  try {
    const auth = await getAuthClient();
    
    if (!auth) {
      throw new Error('Google Calendar not configured');
    }

    const calendar = google.calendar({ version: 'v3', auth });

    const calendarId = resolveCalendarId(options);

    // Buscar eventos no período
    const response = await calendar.events.list({
      calendarId: calendarId || 'primary',
      timeMin: startTime.toISOString(),
      timeMax: endTime.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = response.data.items || [];

    const requestedType = String(options.agendaType || '').toLowerCase();

    const ALLOWED_OVERLAP = ['online', 'visita', 'presencial'];

    const hasConflict = events.some(event => {
      const eventStart = new Date(event.start.dateTime || event.start.date);
      const eventEnd = new Date(event.end.dateTime || event.end.date);
      const overlaps = startTime < eventEnd && endTime > eventStart;
      if (!overlaps) return false;

      const eventType = (event.extendedProperties?.private?.agendaType || '').toLowerCase();
      const requestedType = String(options.agendaType || '').toLowerCase();

      // Se algum tipo não definido, assumir que pode coexistir
      if (!eventType || !requestedType) return false;

      // Se ambos forem tipos que podem coexistir e forem diferentes, NÃO há conflito
      if (ALLOWED_OVERLAP.includes(eventType) && ALLOWED_OVERLAP.includes(requestedType) && eventType !== requestedType) {
        return false;
      }

      // Conflito se for mesmo tipo
      return eventType === requestedType;
    });

    return {
      available: !hasConflict,
      conflicts: events.filter(event => {
        const eventStart = new Date(event.start.dateTime || event.start.date);
        const eventEnd = new Date(event.end.dateTime || event.end.date);
        const overlaps = startTime < eventEnd && endTime > eventStart;
        const eventType = (event.extendedProperties?.private?.agendaType || '').toLowerCase();
        const requestedType = String(options.agendaType || '').toLowerCase();

        // Se algum tipo não definido, assumir que pode coexistir
        if (!eventType || !requestedType) return false;

        if (ALLOWED_OVERLAP.includes(eventType) && ALLOWED_OVERLAP.includes(requestedType) && eventType !== requestedType) {
          return false;
        }

        return eventType === requestedType;
      })
    };
  } catch (error) {
    console.error('Error checking time slot availability:', error);
    throw error;
  }
}

// Função para sugerir horários alternativos
async function suggestAlternativeTimes(requestedStartTime, durationMinutes = DEFAULT_MEETING_DURATION, options = {}) {
  try {
    const auth = await getAuthClient();
    
    if (!auth) {
      throw new Error('Google Calendar not configured');
    }

    const calendar = google.calendar({ version: 'v3', auth });
    const suggestions = [];
    const calendarId = resolveCalendarId(options);
    
    // Buscar eventos do dia (limites do dia em BRT)
    const { y, m, d } = getBrazilYMD(requestedStartTime);
    const startOfDay = makeUtcFromBrazil(y, m, d, 0, 0);
    const endOfDay = makeUtcFromBrazil(y, m, d, 23, 59);

    const response = await calendar.events.list({
      calendarId: calendarId || 'primary',
      timeMin: startOfDay.toISOString(),
      timeMax: endOfDay.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = response.data.items || [];
    const requestedType = String(options.agendaType || '').toLowerCase();
    
    // Janela de trabalho em BRT convertida para UTC
    const workStart = makeUtcFromBrazil(y, m, d, WORK_HOURS.start, WORK_HOURS.startMinutes || 0);
    const workEnd = makeUtcFromBrazil(y, m, d, WORK_HOURS.end, WORK_HOURS.endMinutes || 0);

    // Verificar intervalos de 30 minutos
    for (let time = new Date(workStart); time < workEnd; time.setMinutes(time.getMinutes() + 30)) {
      const slotEnd = new Date(time.getTime() + durationMinutes * 60000);
      
      if (slotEnd > workEnd) break;
      
      // Verificar se o horário está livre para o MESMO tipo de agenda
      const hasConflict = events.some(event => {
        const eventStart = new Date(event.start.dateTime || event.start.date);
        const eventEnd = new Date(event.end.dateTime || event.end.date);
        const eventType = event.extendedProperties?.private?.agendaType?.toLowerCase() || '';
        const overlaps = (time < eventEnd && slotEnd > eventStart);
        if (!overlaps) return false;
        if (!requestedType) return true; // sem tipo, considerar ocupado
        if (!eventType) return true; // sem tipo salvo, considerar ocupado
        return eventType === requestedType;
      });

      if (!hasConflict) {
        suggestions.push({
          start: new Date(time),
          end: new Date(slotEnd),
          available: true
        });
      }

      // Limitar a 5 sugestões
      if (suggestions.length >= 5) break;
    }

    return suggestions;
  } catch (error) {
    console.error('Error suggesting alternative times:', error);
    throw error;
  }
}

// Função para validar e criar evento com verificação de disponibilidade
async function createCalendarEventWithValidation(summary, description, startTime, endTime, options = {}) {
  try {
    // Validar horário de trabalho
    if (!isWithinWorkingHours(startTime)) {
      throw new Error('Horário fora do expediente de trabalho (8h às 18h, segunda a sexta)');
    }

    if (!isWithinWorkingHours(endTime)) {
      throw new Error('Horário de término fora do expediente de trabalho (8h às 18h, segunda a sexta)');
    }

    // Verificar disponibilidade
    const availability = await checkTimeSlotAvailability(startTime, endTime, options);
    
    if (!availability.available) {
      const suggestions = await suggestAlternativeTimes(startTime, options.durationMinutes, options);
      
      throw new Error(`Horário não disponível. Conflitos encontrados: ${availability.conflicts.length}. Sugestões de horários alternativos: ${suggestions.length} opções disponíveis.`);
    }

    // Criar o evento
    return await createCalendarEvent(summary, description, startTime, endTime, options);
    
  } catch (error) {
    console.error('Error creating calendar event with validation:', error);
    throw error;
  }
}

async function createCalendarEvent(summary, description, startTime, endTime, options = {}) {
  try {
    const auth = await getAuthClient();
    
    if (!auth) {
      throw new Error('Google Calendar not configured');
    }

    const calendar = google.calendar({ version: 'v3', auth });
    const calendarId = resolveCalendarId(options);

    const event = {
      summary,
      description,
      start: {
        dateTime: startTime.toISOString(),
        timeZone: 'America/Sao_Paulo',
      },
      end: {
        dateTime: endTime.toISOString(),
        timeZone: 'America/Sao_Paulo',
      },
      extendedProperties: {
        private: {
          agendaType: String(options.agendaType || ''),
          clientName: String(options.clientName || ''),
        }
      }
    };

    const response = await calendar.events.insert({
      calendarId: calendarId || 'primary',
      resource: event,
    });

    return response.data;
  } catch (error) {
    console.error('Error creating calendar event:', error);
    throw error;
  }
}

async function updateCalendarEvent(eventId, summary, description, startTime, endTime, options = {}) {
  try {
    const auth = await getAuthClient();
    
    if (!auth) {
      throw new Error('Google Calendar not configured');
    }

    const calendar = google.calendar({ version: 'v3', auth });
    const calendarId = resolveCalendarId(options);

    const event = {
      summary,
      description,
      start: {
        dateTime: startTime.toISOString(),
        timeZone: 'America/Sao_Paulo',
      },
      end: {
        dateTime: endTime.toISOString(),
        timeZone: 'America/Sao_Paulo',
      },
      extendedProperties: {
        private: {
          agendaType: String(options.agendaType || ''),
          clientName: String(options.clientName || ''),
        }
      }
    };

    const response = await calendar.events.patch({
      calendarId: calendarId || 'primary',
      eventId: eventId,
      resource: event,
    });

    return response.data;
  } catch (error) {
    console.error('Error updating calendar event:', error);
    throw error;
  }
}

async function deleteCalendarEvent(eventId, options = {}) {
  try {
    const auth = await getAuthClient();
    
    if (!auth) {
      throw new Error('Google Calendar not configured');
    }

    const calendar = google.calendar({ version: 'v3', auth });
    // Tentar em múltiplos calendars se necessário (evita falhas por mudança de mapeamento/env)
    const candidates = [
      resolveCalendarId(options),
      process.env.CALENDAR_ID,
      process.env.GOOGLE_CALENDAR_ID,
      process.env.GOOGLE_CALENDAR_ID_ONLINE,
      process.env.GOOGLE_CALENDAR_ID_LOJA,
      'primary',
    ]
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i);

    let lastError = null;
    let sawNotFound = false; // 404/410
    for (const cid of candidates) {
      try {
        console.log(`🗑️ Tentando deletar evento ${eventId} em calendarId='${cid}'...`);
        const response = await calendar.events.delete({ calendarId: cid, eventId });
        console.log(`✅ Evento ${eventId} deletado de '${cid}'`);
        return response.data;
      } catch (err) {
        lastError = err;
        const code = err?.code || err?.response?.status;
        console.warn(`⚠️ Falha ao deletar em '${cid}': ${err.message} (code=${code})`);
        // Tratar 404 (Not Found) e 410 (Gone) como idempotente: continuar tentando outros calendars
        if (code && (String(code) === '404' || String(code) === '410')) {
          sawNotFound = true;
          continue;
        }
        // Outros erros (ex.: 403) interrompem as tentativas
        break;
      }
    }

    // Se só tivemos 404/410 em todos os candidates, considerar como sucesso idempotente
    if (sawNotFound && (!lastError || (String(lastError.code) === '404' || String(lastError.code) === '410' || String(lastError?.response?.status) === '404' || String(lastError?.response?.status) === '410'))) {
      console.log(`ℹ️ Evento ${eventId} já estava ausente em todos os calendars candidatos. Tratando como deleção bem-sucedida.`);
      return { status: 'gone' };
    }

    // Se chegou aqui, houve erro real
    throw lastError || new Error('Falha ao deletar evento do Google Calendar');
  } catch (error) {
    console.error('Error deleting calendar event:', error);
    throw error;
  }
}

module.exports = {
  createCalendarEvent,
  createCalendarEventWithValidation,
  checkTimeSlotAvailability,
  suggestAlternativeTimes,
  isWithinWorkingHours,
  getAuthClient,
  updateCalendarEvent,
  deleteCalendarEvent,
  resolveCalendarId,
};
