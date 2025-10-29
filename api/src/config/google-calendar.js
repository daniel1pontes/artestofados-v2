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

function getAuthClient() {
  if (!authClient) {
    const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    
    if (!keyPath) {
      console.warn('Google Calendar credentials not configured');
      return null;
    }

    authClient = new google.auth.GoogleAuth({
      keyFile: keyPath,
      scopes: ['https://www.googleapis.com/auth/calendar'],
    });
  }

  return authClient;
}

// Função para verificar se um horário está dentro do horário de trabalho
function isWithinWorkingHours(dateTime) {
  const date = new Date(dateTime);
  const dayOfWeek = date.getDay(); // 0 = domingo, 1 = segunda, etc.
  const hour = date.getHours();
  
  return WORK_HOURS.workingDays.includes(dayOfWeek) && 
         hour >= WORK_HOURS.start && 
         hour < WORK_HOURS.end;
}

// Função para verificar conflitos de horário
async function checkTimeSlotAvailability(startTime, endTime) {
  try {
    const auth = getAuthClient();
    
    if (!auth) {
      throw new Error('Google Calendar not configured');
    }

    const calendar = google.calendar({ version: 'v3', auth });

    // Buscar eventos no período
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: startTime.toISOString(),
      timeMax: endTime.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = response.data.items || [];
    
    // Verificar se há conflitos
    const hasConflict = events.some(event => {
      const eventStart = new Date(event.start.dateTime || event.start.date);
      const eventEnd = new Date(event.end.dateTime || event.end.date);
      
      // Verificar sobreposição de horários
      return (startTime < eventEnd && endTime > eventStart);
    });

    return {
      available: !hasConflict,
      conflicts: events.filter(event => {
        const eventStart = new Date(event.start.dateTime || event.start.date);
        const eventEnd = new Date(event.end.dateTime || event.end.date);
        return (startTime < eventEnd && endTime > eventStart);
      })
    };
  } catch (error) {
    console.error('Error checking time slot availability:', error);
    throw error;
  }
}

// Função para sugerir horários alternativos
async function suggestAlternativeTimes(requestedStartTime, durationMinutes = DEFAULT_MEETING_DURATION) {
  try {
    const auth = getAuthClient();
    
    if (!auth) {
      throw new Error('Google Calendar not configured');
    }

    const calendar = google.calendar({ version: 'v3', auth });
    const suggestions = [];
    
    // Buscar eventos do dia
    const startOfDay = new Date(requestedStartTime);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(requestedStartTime);
    endOfDay.setHours(23, 59, 59, 999);

    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: startOfDay.toISOString(),
      timeMax: endOfDay.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = response.data.items || [];
    
    // Gerar sugestões de horários livres
    const workStart = new Date(requestedStartTime);
    workStart.setHours(WORK_HOURS.start, 0, 0, 0);
    
    const workEnd = new Date(requestedStartTime);
    workEnd.setHours(WORK_HOURS.end, 0, 0, 0);

    // Verificar intervalos de 30 minutos
    for (let time = new Date(workStart); time < workEnd; time.setMinutes(time.getMinutes() + 30)) {
      const slotEnd = new Date(time.getTime() + durationMinutes * 60000);
      
      if (slotEnd > workEnd) break;
      
      // Verificar se o horário está livre
      const hasConflict = events.some(event => {
        const eventStart = new Date(event.start.dateTime || event.start.date);
        const eventEnd = new Date(event.end.dateTime || event.end.date);
        return (time < eventEnd && slotEnd > eventStart);
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
    const availability = await checkTimeSlotAvailability(startTime, endTime);
    
    if (!availability.available) {
      const suggestions = await suggestAlternativeTimes(startTime, options.durationMinutes);
      
      throw new Error(`Horário não disponível. Conflitos encontrados: ${availability.conflicts.length}. Sugestões de horários alternativos: ${suggestions.length} opções disponíveis.`);
    }

    // Criar o evento
    return await createCalendarEvent(summary, description, startTime, endTime);
    
  } catch (error) {
    console.error('Error creating calendar event with validation:', error);
    throw error;
  }
}

async function createCalendarEvent(summary, description, startTime, endTime) {
  try {
    const auth = getAuthClient();
    
    if (!auth) {
      throw new Error('Google Calendar not configured');
    }

    const calendar = google.calendar({ version: 'v3', auth });

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
    };

    const response = await calendar.events.insert({
      calendarId: 'primary',
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
};

