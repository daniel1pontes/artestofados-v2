const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });


const { createCalendarEvent } = require('./google-calendar');

(async () => {
  try {
    const startTime = new Date();
    startTime.setDate(startTime.getDate() + 1); // amanhã
    startTime.setHours(15, 0, 0, 0);

    const endTime = new Date(startTime);
    endTime.setHours(endTime.getHours() + 1);

    const event = await createCalendarEvent('Teste de reunião', 'Descrição teste', startTime, endTime, { agendaType: 'loja', clientName: 'Luciana' });

    console.log('Evento criado com sucesso:', event.htmlLink);
  } catch (err) {
    console.error('Erro ao criar evento:', err);
  }
})();

