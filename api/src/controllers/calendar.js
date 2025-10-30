const { 
  createCalendarEventWithValidation, 
  checkTimeSlotAvailability, 
  suggestAlternativeTimes,
  isWithinWorkingHours,
  createCalendarEvent  // ✅ ADICIONAR ESTA IMPORTAÇÃO
} = require('../config/google-calendar');
const { createAppointment, findConflicts } = require('../models/agendamento');

function normalizeAgendaType(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'reuniao' || t === 'online') return 'online';
  if (t === 'visita' || t === 'presencial' || t === 'loja') return 'loja';
  return t;
}

function parseBrazilDateTime(input) {
  if (!input) return null;
  if (input instanceof Date) return input;
  if (typeof input === 'number') return new Date(input);
  const str = String(input);
  const hasTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(str);
  if (hasTz) return new Date(str);
  const m = str.trim().replace(' ', 'T').match(/^(\d{4})-(\d{2})-(\d{2})[T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return new Date(str);
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10) - 1;
  const d = parseInt(m[3], 10);
  const h = parseInt(m[4], 10);
  const mi = parseInt(m[5], 10);
  const s = m[6] ? parseInt(m[6], 10) : 0;
  return new Date(Date.UTC(y, mo, d, h + 3, mi, s));
}

const calendarController = {
  async checkAvailability(req, res) {
    try {
      const { startTime, endTime, agendaType, calendarId } = req.body;

      if (!startTime || !endTime) {
        return res.status(400).json({ 
          error: 'startTime e endTime são obrigatórios' 
        });
      }

      const start = parseBrazilDateTime(startTime);
      const end = parseBrazilDateTime(endTime);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({ 
          error: 'Datas inválidas' 
        });
      }

      if (!isWithinWorkingHours(start) || !isWithinWorkingHours(end)) {
        return res.status(400).json({ 
          error: 'Horário fora do expediente de trabalho (8h às 18h, segunda a sexta)',
          available: false
        });
      }

      const dbConflicts = await findConflicts(start, end, normalizeAgendaType(agendaType));

      res.json({
        available: dbConflicts.length === 0,
        conflicts: dbConflicts.length,
        message: dbConflicts.length === 0 ? 'Horário disponível' : 'Horário não disponível.'
      });

    } catch (error) {
      console.error('Error checking availability:', error);
      res.status(500).json({ 
        error: 'Erro interno do servidor',
        details: error.message 
      });
    }
  },

  async suggestTimes(req, res) {
    try {
      const { requestedTime, duration = 60, agendaType, calendarId } = req.body;

      if (!requestedTime) {
        return res.status(400).json({ 
          error: 'requestedTime é obrigatório' 
        });
      }

      const requested = new Date(requestedTime);

      if (isNaN(requested.getTime())) {
        return res.status(400).json({ 
          error: 'Data inválida' 
        });
      }

      const suggestions = await suggestAlternativeTimes(requested, duration, { agendaType, calendarId });

      res.json({
        requestedTime: requested.toISOString(),
        suggestions: suggestions.map(s => ({
          start: s.start.toISOString(),
          end: s.end.toISOString(),
          formatted: `${s.start.toLocaleString('pt-BR')} - ${s.end.toLocaleString('pt-BR')}`
        })),
        count: suggestions.length
      });

    } catch (error) {
      console.error('Error suggesting times:', error);
      res.status(500).json({ 
        error: 'Erro interno do servidor',
        details: error.message 
      });
    }
  },

  async createEvent(req, res) {
    try {
      const { summary, description, startTime, endTime, duration = 60, agendaType, calendarId, clientName } = req.body;

      if (!startTime) {
        return res.status(400).json({ 
          error: 'startTime é obrigatório' 
        });
      }

      const start = parseBrazilDateTime(startTime);
      let end;

      if (endTime) {
        end = parseBrazilDateTime(endTime);
      } else {
        end = new Date(start.getTime() + duration * 60000);
      }

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({ 
          error: 'Datas inválidas' 
        });
      }

      const normalizedType = normalizeAgendaType(agendaType);
      const dbConflicts = await findConflicts(start, end, normalizedType);
      if (dbConflicts.length > 0) {
        return res.status(409).json({
          error: 'Horário não disponível (conflito no banco para este tipo)'
        });
      }

      const autoSummary = summary || (normalizedType === 'online' 
        ? `Atendimento - Reunião Online${clientName ? ` | ${clientName}` : ''}`
        : `Atendimento - Visita à Loja${clientName ? ` | ${clientName}` : ''}`);

      const autoDescription = description || 
        `Cliente: ${clientName || ''}\nTipo: ${normalizedType === 'online' ? 'Reunião Online' : 'Visita à Loja'}`;

      // ✅ CRIAR NO GOOGLE CALENDAR PRIMEIRO
      console.log('📅 Criando evento no Google Calendar...');
      let calendarEvent = null;
      let calendarEventId = null;
      let htmlLink = null;

      try {
        calendarEvent = await createCalendarEvent(
          autoSummary,
          autoDescription,
          start,
          end,
          { agendaType: normalizedType, clientName, calendarId }
        );
        
        calendarEventId = calendarEvent.id;
        htmlLink = calendarEvent.htmlLink;
        
        console.log('✅ Evento criado no Google Calendar:', calendarEventId);
        console.log('🔗 Link:', htmlLink);
      } catch (calendarError) {
        console.error('❌ Erro ao criar no Google Calendar:', calendarError.message);
        // Se falhar no Google Calendar, não salvar no banco
        return res.status(500).json({
          error: 'Erro ao criar evento no Google Calendar',
          details: calendarError.message
        });
      }

      // ✅ SALVAR NO BANCO APENAS SE GOOGLE CALENDAR FUNCIONAR
      console.log('💾 Salvando no banco de dados...');
      await createAppointment({
        calendarEventId,  // ✅ AGORA TEM O ID DO GOOGLE CALENDAR
        summary: autoSummary,
        description: autoDescription,
        startTime: start,
        endTime: end,
        agendaType: normalizedType,
        clientName: clientName || null,
      });

      console.log('✅ Salvo no banco de dados');

      res.json({
        success: true,
        event: {
          id: calendarEventId,
          summary: autoSummary,
          start: start.toISOString(),
          end: end.toISOString(),
          htmlLink: htmlLink
        },
        message: 'Evento criado com sucesso no Google Calendar e banco de dados'
      });

    } catch (error) {
      console.error('Error creating event:', error);
      
      if (error.message.includes('Horário não disponível')) {
        try {
          const start = new Date(req.body.startTime);
          const suggestions = await suggestAlternativeTimes(start, req.body.duration || 60, { agendaType: req.body.agendaType, calendarId: req.body.calendarId });
          
          return res.status(409).json({
            error: 'Horário não disponível',
            details: error.message,
            suggestions: suggestions.map(s => ({
              start: s.start.toISOString(),
              end: s.end.toISOString(),
              formatted: `${s.start.toLocaleString('pt-BR')} - ${s.end.toLocaleString('pt-BR')}`
            }))
          });
        } catch (suggestionError) {
          console.error('Error getting suggestions:', suggestionError);
        }
      }

      res.status(500).json({ 
        error: 'Erro interno do servidor',
        details: error.message 
      });
    }
  },

  async checkWorkingHours(req, res) {
    try {
      const { dateTime } = req.body;

      if (!dateTime) {
        return res.status(400).json({ 
          error: 'dateTime é obrigatório' 
        });
      }

      const date = new Date(dateTime);

      if (isNaN(date.getTime())) {
        return res.status(400).json({ 
          error: 'Data inválida' 
        });
      }

      const isWorking = isWithinWorkingHours(date);

      res.json({
        dateTime: date.toISOString(),
        isWorkingHours: isWorking,
        dayOfWeek: date.toLocaleDateString('pt-BR', { weekday: 'long' }),
        hour: date.getHours(),
        message: isWorking 
          ? 'Horário dentro do expediente' 
          : 'Horário fora do expediente (8h às 18h, segunda a sexta)'
      });

    } catch (error) {
      console.error('Error checking working hours:', error);
      res.status(500).json({ 
        error: 'Erro interno do servidor',
        details: error.message 
      });
    }
  }
};

module.exports = calendarController;