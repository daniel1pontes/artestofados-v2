const { google } = require('googleapis');
const path = require('path');

let authClient = null;

// Configurações de horário de trabalho (8h às 18h, segunda a sexta)
const WORK_HOURS = {
  start: 8, // 8:00
  end: 18,  // 18:00
  workingDays: [1, 2, 3, 4, 5] // Segunda a sexta
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

async function getAuthClient() {
  if (authClient) return authClient;

  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyPath) {
    console.warn('⚠️ GOOGLE_SERVICE_ACCOUNT_KEY não configurado.');
    return null;
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
  const fmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour12: false, weekday: 'short', hour: '2-digit' });
  const parts = fmt.formatToParts(date);
  const hourPart = parts.find(p => p.type === 'hour');
  const weekdayPart = parts.find(p => p.type === 'weekday');
  const hour = hourPart ? parseInt(hourPart.value, 10) : date.getUTCHours();
  // Mapear weekday pt-BR curto para número (0=domingo)
  const weekdayMap = { 'dom': 0, 'seg': 1, 'ter': 2, 'qua': 3, 'qui': 4, 'sex': 5, 'sáb': 6, 'sab': 6 };
  const dow = weekdayMap[(weekdayPart?.value || '').toLowerCase()] ?? date.getUTCDay();

  return WORK_HOURS.workingDays.includes(dow) && hour >= WORK_HOURS.start && hour < WORK_HOURS.end;
}

// Função para verificar conflitos de horário
async function checkTimeSlotAvailability(startTime, endTime, options = {}) {
  try {
    const auth = await getAuthClient();
    
    if (!auth) {
      throw new Error('Google Calendar not configured');
    }

    const calendar = google.calendar({ version: 'v3', auth });

    const calendarId = options.calendarId || getCalendarIdByType(options.agendaType);

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

    // Verificar se há conflitos apenas com o MESMO tipo de agenda
    const hasConflict = events.some(event => {
      const eventStart = new Date(event.start.dateTime || event.start.date);
      const eventEnd = new Date(event.end.dateTime || event.end.date);
      const eventType = event.extendedProperties?.private?.agendaType?.toLowerCase() || '';
      const overlaps = (startTime < eventEnd && endTime > eventStart);
      if (!overlaps) return false;
      if (!requestedType) return true; // sem tipo informado, considerar conflito
      // Se o evento existente não tem tipo salvo, considerar conflito para qualquer tipo solicitado
      if (!eventType) return true;
      return eventType === requestedType; // conflito só se mesmo tipo
    });

    return {
      available: !hasConflict,
      conflicts: events.filter(event => {
        const eventStart = new Date(event.start.dateTime || event.start.date);
        const eventEnd = new Date(event.end.dateTime || event.end.date);
        const eventType = event.extendedProperties?.private?.agendaType?.toLowerCase() || '';
        const overlaps = (startTime < eventEnd && endTime > eventStart);
        if (!overlaps) return false;
        if (!requestedType) return true;
        if (!eventType) return true;
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
    const calendarId = options.calendarId || getCalendarIdByType(options.agendaType);
    
    // Buscar eventos do dia
    const startOfDay = new Date(requestedStartTime);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(requestedStartTime);
    endOfDay.setHours(23, 59, 59, 999);

    const response = await calendar.events.list({
      calendarId: calendarId || 'primary',
      timeMin: startOfDay.toISOString(),
      timeMax: endOfDay.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = response.data.items || [];
    const requestedType = String(options.agendaType || '').toLowerCase();
    
    // Gerar sugestões de horários livres
    const workStart = new Date(requestedStartTime);
    workStart.setHours(WORK_HOURS.start, 0, 0, 0);
    
    const workEnd = new Date(requestedStartTime);
    workEnd.setHours(WORK_HOURS.end, 0, 0, 0);

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
    const calendarId = options.calendarId || getCalendarIdByType(options.agendaType);

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

module.exports = {
  createCalendarEvent,
  createCalendarEventWithValidation,
  checkTimeSlotAvailability,
  suggestAlternativeTimes,
  isWithinWorkingHours,
  getAuthClient,
};

