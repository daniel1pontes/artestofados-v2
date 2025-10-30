const {
  checkTimeSlotAvailability,
  createCalendarEventWithValidation,
  createCalendarEvent,
  getAuthClient,
} = require('../config/google-calendar');
const { google } = require('googleapis');
const pool = require('../config/database');

async function checkAvailability(dateStart, dateEnd, type) {
  const start = new Date(dateStart);
  const end = new Date(dateEnd);
  // Calendar (com regra por tipo já aplicada internamente)
  const cal = await checkTimeSlotAvailability(start, end, { agendaType: type });
  // DB (mesmo tipo)
  const db = await pool.query(
    `SELECT id FROM appointments WHERE agenda_type = $1 AND start_time < $3 AND end_time > $2`,
    [String(type || '').toLowerCase(), start, end]
  );
  return {
    available: cal.available && db.rows.length === 0,
    calendarConflicts: cal.conflicts.length,
    dbConflicts: db.rows.length,
  };
}

async function createGoogleEvent(agendamento) {
  const {
    resumo,
    tipo, // 'reuniao' | 'visita'
    data, // Date ou ISO
    duracaoMin = 60,
    cliente_nome,
    cliente_whatsapp,
    local,
  } = agendamento;

  const start = new Date(data);
  const end = new Date(start.getTime() + duracaoMin * 60000);

  const summary = resumo || (String(tipo).toLowerCase() === 'reuniao'
    ? `Atendimento - Reunião Online${cliente_nome ? ` | ${cliente_nome}` : ''}`
    : `Atendimento - Visita à Loja${cliente_nome ? ` | ${cliente_nome}` : ''}`);

  const description = `Cliente: ${cliente_nome || ''}\nWhatsApp: ${cliente_whatsapp || ''}\nTipo: ${tipo}\nLocal: ${local || (String(tipo).toLowerCase() === 'reuniao' ? 'Online' : 'Loja')}`;

  const event = await createCalendarEventWithValidation(
    summary,
    description,
    start,
    end,
    { durationMinutes: duracaoMin, agendaType: tipo === 'reuniao' ? 'online' : 'loja', clientName: cliente_nome }
  );

  // Persistir em appointments (mantendo compatibilidade com estrutura atual)
  await pool.query(
    `INSERT INTO appointments (calendar_event_id, summary, description, start_time, end_time, agenda_type, client_name, phone_number, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())`,
    [event.id, summary, description, start, end, (tipo === 'reuniao' ? 'online' : 'loja'), cliente_nome || null, cliente_whatsapp || null]
  );

  return event;
}

async function deleteGoogleEvent(eventId) {
  try {
    const auth = getAuthClient();
    const calendar = google.calendar({ version: 'v3', auth });
    await calendar.events.delete({ calendarId: 'primary', eventId });
    await pool.query(`DELETE FROM appointments WHERE calendar_event_id = $1`, [eventId]);
    return true;
  } catch (err) {
    console.error('❌ deleteGoogleEvent error:', err.message);
    throw err;
  }
}

function toBr(date) {
  return new Date(date).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

async function listUpcomingEvents(options = {}) {
  const {
    limit = 500,
    from,
    to,
    tipo, // 'visita' | 'reuniao' | undefined
    order = 'ASC',
  } = options || {};

  const clauses = [];
  const params = [];

  if (from) {
    params.push(new Date(from));
    clauses.push(`start_time >= $${params.length}`);
  }
  if (to) {
    params.push(new Date(to));
    clauses.push(`start_time <= $${params.length}`);
  }
  if (tipo === 'reuniao') {
    params.push('online');
    clauses.push(`agenda_type = $${params.length}`);
  } else if (tipo === 'visita') {
    params.push(['loja', 'visita', 'presencial']);
    clauses.push(`agenda_type = ANY($${params.length})`);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const result = await pool.query(
    `SELECT 
        id,
        client_name AS cliente_nome,
        phone_number AS cliente_whatsapp,
        CASE WHEN agenda_type='online' THEN 'reuniao' ELSE 'visita' END AS tipo,
        start_time AS data,
        end_time   AS fim,
        CASE WHEN agenda_type='online' THEN 'Online' ELSE 'Av. Almirante Barroso, 389, Centro – João Pessoa – PB' END AS local,
        calendar_event_id AS google_event_id,
        summary AS resumo
      FROM appointments
      ${where}
      ORDER BY start_time ${order === 'DESC' ? 'DESC' : 'ASC'}
      LIMIT ${Number(limit) || 500}`,
    params
  );

  // Acrescentar campos em BR para facilitar debug no front
  return result.rows.map(r => ({
    ...r,
    data_br: toBr(r.data),
    fim_br: toBr(r.fim),
  }));
}

module.exports = {
  checkAvailability,
  createGoogleEvent,
  deleteGoogleEvent,
  listUpcomingEvents,
};


