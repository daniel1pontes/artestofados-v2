const { 
  createCalendarEventWithValidation, 
  checkTimeSlotAvailability, 
  suggestAlternativeTimes,
  isWithinWorkingHours 
} = require('../config/google-calendar');

const calendarController = {
  // Verificar disponibilidade de um horário específico
  async checkAvailability(req, res) {
    try {
      const { startTime, endTime } = req.body;

      if (!startTime || !endTime) {
        return res.status(400).json({ 
          error: 'startTime e endTime são obrigatórios' 
        });
      }

      const start = new Date(startTime);
      const end = new Date(endTime);

      // Validar se as datas são válidas
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({ 
          error: 'Datas inválidas' 
        });
      }

      // Verificar se está dentro do horário de trabalho
      if (!isWithinWorkingHours(start) || !isWithinWorkingHours(end)) {
        return res.status(400).json({ 
          error: 'Horário fora do expediente de trabalho (8h às 18h, segunda a sexta)',
          available: false
        });
      }

      const availability = await checkTimeSlotAvailability(start, end);

      res.json({
        available: availability.available,
        conflicts: availability.conflicts.length,
        message: availability.available 
          ? 'Horário disponível' 
          : `Horário não disponível. ${availability.conflicts.length} conflito(s) encontrado(s)`
      });

    } catch (error) {
      console.error('Error checking availability:', error);
      res.status(500).json({ 
        error: 'Erro interno do servidor',
        details: error.message 
      });
    }
  },

  // Sugerir horários alternativos
  async suggestTimes(req, res) {
    try {
      const { requestedTime, duration = 60 } = req.body;

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

      const suggestions = await suggestAlternativeTimes(requested, duration);

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

  // Criar evento com validação
  async createEvent(req, res) {
    try {
      const { summary, description, startTime, endTime, duration = 60 } = req.body;

      if (!summary || !startTime) {
        return res.status(400).json({ 
          error: 'summary e startTime são obrigatórios' 
        });
      }

      const start = new Date(startTime);
      let end;

      if (endTime) {
        end = new Date(endTime);
      } else {
        // Se não fornecido, calcular baseado na duração
        end = new Date(start.getTime() + duration * 60000);
      }

      // Validar se as datas são válidas
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({ 
          error: 'Datas inválidas' 
        });
      }

      const event = await createCalendarEventWithValidation(
        summary, 
        description || '', 
        start, 
        end, 
        { durationMinutes: duration }
      );

      res.json({
        success: true,
        event: {
          id: event.id,
          summary: event.summary,
          start: event.start.dateTime,
          end: event.end.dateTime,
          htmlLink: event.htmlLink
        },
        message: 'Evento criado com sucesso'
      });

    } catch (error) {
      console.error('Error creating event:', error);
      
      // Se for erro de disponibilidade, retornar sugestões
      if (error.message.includes('Horário não disponível')) {
        try {
          const start = new Date(req.body.startTime);
          const suggestions = await suggestAlternativeTimes(start, req.body.duration || 60);
          
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

  // Verificar horário de trabalho
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
