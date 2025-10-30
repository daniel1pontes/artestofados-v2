const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const { createCalendarEventWithValidation } = require('./google-calendar');

(async () => {
  try {
    const startTime = new Date();

    // 👉 ir para a próxima segunda-feira
    const day = startTime.getDay(); // 0 = domingo, 1 = segunda...
    const daysUntilMonday = (1 + 7 - day) % 7 || 7; 
    startTime.setDate(startTime.getDate() + daysUntilMonday);

    startTime.setHours(15, 0, 0, 0);
    const endTime = new Date(startTime);
    endTime.setHours(endTime.getHours() + 1);

    // Cria evento visita/loja
    const visitaEvent = await createCalendarEventWithValidation(
      'Visita presencial',
      'Descrição visita',
      startTime,
      endTime,
      { agendaType: 'visita', clientName: 'Luciana' }
    );
    console.log('Evento visita criado:', visitaEvent.htmlLink);

    // Cria evento online no mesmo horário
    const onlineEvent = await createCalendarEventWithValidation(
      'Reunião online',
      'Descrição reunião online',
      startTime,
      endTime,
      { agendaType: 'online', clientName: 'Luciana' }
    );
    console.log('Evento online criado:', onlineEvent.htmlLink);

  } catch (err) {
    console.error('Erro ao criar evento:', err);
  }
})();
