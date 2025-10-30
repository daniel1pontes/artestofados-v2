const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const {
  getAuthClient,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  resolveCalendarId,
} = require('./src/config/google-calendar');

function nextBusinessDayAt(hour, minute) {
  const now = new Date();
  const d = new Date(now);
  d.setHours(hour, minute, 0, 0);
  // se já passou hoje, vai para amanhã
  if (d <= now) d.setDate(d.getDate() + 1);
  // pula fins de semana
  while ([0, 6].includes(d.getDay())) d.setDate(d.getDate() + 1);
  return d;
}

async function main() {
  console.log('== Google Calendar Test ==');
  try {
    const auth = await getAuthClient();
    if (!auth) throw new Error('Credenciais ausentes. Configure GOOGLE_SERVICE_ACCOUNT_KEY ou coloque o JSON em api/credentials/google-service-account.json');

    // Determine calendarId efetivo
    const calendarId = resolveCalendarId({ calendarId: process.env.CALENDAR_ID });
    console.log('🗓️ calendarId alvo:', calendarId || 'primary');

    const start = nextBusinessDayAt(15, 0); // 15:00 BRT próximo dia útil
    const end = new Date(start.getTime() + 60 * 60000);

    console.log('Criando evento LOJA...');
    const loja = await createCalendarEvent(
      'Teste - Visita à Loja',
      'Criado pelo script de teste',
     start,
     end,
     { agendaType: 'loja', clientName: 'Cliente Script', calendarId }
    );
    console.log('✔️ LOJA criado:', loja.id, loja.htmlLink);

    console.log('Criando evento ONLINE no mesmo horário...');
    const online = await createCalendarEvent(
      'Teste - Reunião Online',
      'Criado pelo script de teste',
      start,
      end,
      { agendaType: 'online', clientName: 'Cliente Script', calendarId }
    );
    console.log('✔️ ONLINE criado:', online.id, online.htmlLink);

    //Exemplo de atualização (+30min) descomentando abaixo se quiser testar
    const newStart = new Date(start.getTime() + 30 * 60000);
    const newEnd = new Date(end.getTime() + 30 * 60000);
    console.log('Atualizando evento LOJA (+30min)...');
    const updated = await updateCalendarEvent(
      loja.id,
      'Teste - Visita à Loja (Atualizado)',
       'Atualizado pelo script de teste',
       newStart,
       newEnd,
       { agendaType: 'loja', clientName: 'Cliente Script', calendarId }
    );
    console.log('✔️ LOJA atualizado:', updated.id, updated.htmlLink);

    console.log('\nSe quiser excluir os eventos, descomente as linhas abaixo.');
    await deleteCalendarEvent(loja.id, { agendaType: 'loja', calendarId });
    await deleteCalendarEvent(online.id, { agendaType: 'online', calendarId });
    console.log('✔️ Eventos excluídos');

    console.log('\nConcluído. Verifique no Google Calendar.');
  } catch (err) {
    console.error('❌ Erro no teste:', err.response?.data || err.message || err);
    process.exitCode = 1;
  }
}

main();
