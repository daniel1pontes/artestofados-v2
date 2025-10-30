const {
  createCalendarEventWithValidation,
  getAuthClient,
} = require('../config/google-calendar');
const { google } = require('googleapis');
const pool = require('../config/database');

async function checkTimeSlotAvailability(startTime, endTime, options = {}) {
  try {
    const auth = await getAuthClient();
    if (!auth) throw new Error('Google Calendar não configurado');

    const calendar = google.calendar({ version: 'v3', auth });
    const calendarId = options.calendarId || 'primary';

    const response = await calendar.events.list({
      calendarId,
      timeMin: startTime.toISOString(),
      timeMax: endTime.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      fields: 'items(id,summary,start,end,extendedProperties)',
    });

    const events = response.data.items || [];
    const requestedType = String(options.agendaType || '').toLowerCase();

    const conflicts = events.filter(event => {
      const eventStart = new Date(event.start.dateTime || event.start.date);
      const eventEnd = new Date(event.end.dateTime || event.end.date);
      const overlaps = startTime < eventEnd && endTime > eventStart;

      const eventType = (event.extendedProperties?.private?.agendaType || '').toLowerCase();
      return overlaps && eventType === requestedType;
    });

    return {
      available: conflicts.length === 0,
      conflicts,
    };
  } catch (error) {
    console.error('Error checking time slot availability:', error);
    throw error;
  }
}

async function createGoogleEvent(agendamento) {
  const {
    resumo,
    tipo,
    data,
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
    { durationMinutes: duracaoMin, agendaType: tipo === 'reuniao' ? 'reuniao' : 'visita', clientName: cliente_nome }
  );

  await pool.query(
    `INSERT INTO appointments (calendar_event_id, summary, description, start_time, end_time, agenda_type, client_name, phone_number, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())`,
    [event.id, summary, description, start, end, tipo === 'reuniao' ? 'reuniao' : 'visita', cliente_nome || null, cliente_whatsapp || null]
  );

  return event;
}

async function deleteGoogleEvent(eventId) {
  try {
    const auth = await getAuthClient();
    if (!auth) throw new Error('Falha ao autenticar no Google Calendar');
    const calendar = google.calendar({ version: 'v3', auth });
    await calendar.events.delete({ calendarId: 'primary', eventId });
    await pool.query(`DELETE FROM appointments WHERE calendar_event_id = $1`, [eventId]);
    console.log(`🗑️ Evento ${eventId} removido do Google Calendar e do banco.`);
    return true;
  } catch (err) {
    console.error('❌ Erro ao excluir evento do Google Calendar:', err.message);
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
    tipo,
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
  if (tipo) {
    params.push(tipo);
    clauses.push(`agenda_type = $${params.length}`);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const result = await pool.query(
    `SELECT 
        id,
        client_name AS cliente_nome,
        phone_number AS cliente_whatsapp,
        agenda_type AS tipo,
        start_time AS data,
        end_time   AS fim,
        CASE WHEN agenda_type='reuniao' THEN 'Online' ELSE 'Av. Almirante Barroso, 389, Centro – João Pessoa – PB' END AS local,
        calendar_event_id AS google_event_id,
        summary AS resumo
      FROM appointments
      ${where}
      ORDER BY start_time ${order === 'DESC' ? 'DESC' : 'ASC'}
      LIMIT ${Number(limit) || 500}`,
    params
  );

  return result.rows.map(r => ({
    ...r,
    data_br: toBr(r.data),
    fim_br: toBr(r.fim),
  }));
}

/**
 * ✅ Cancela o agendamento no banco **e** no Google Calendar.
 */
async function cancelAppointment({ data, tipo }) {
  try {
    if (!data || !tipo) {
      throw new Error('Data e tipo são obrigatórios para cancelar um agendamento.');
    }

    const start = new Date(data);
    const tipoAgenda = tipo.toLowerCase();

    const { rows } = await pool.query(
      `SELECT calendar_event_id 
         FROM appointments 
        WHERE agenda_type = $1 
          AND start_time = $2
        LIMIT 1`,
      [tipoAgenda, start]
    );

    if (rows.length === 0) {
      console.log('⚠️ Nenhum agendamento encontrado para cancelar.');
      return { success: false, message: 'Nenhum agendamento encontrado.' };
    }

    const eventId = rows[0].calendar_event_id;

    const auth = await getAuthClient();
    if (!auth) throw new Error('Falha ao autenticar no Google Calendar');

    const calendar = google.calendar({ version: 'v3', auth });
    await calendar.events.delete({ calendarId: 'primary', eventId });

    await pool.query(`DELETE FROM appointments WHERE calendar_event_id = $1`, [eventId]);

    console.log(`✅ Agendamento cancelado (Google + Banco): tipo=${tipo}, data=${start.toISOString()}`);
    return { success: true, message: 'Agendamento cancelado com sucesso.' };
  } catch (err) {
    console.error('❌ Erro ao cancelar agendamento:', err.message);
    return { success: false, message: err.message };
  }
}

module.exports = {
  checkTimeSlotAvailability,
  createGoogleEvent,
  deleteGoogleEvent,
  listUpcomingEvents,
  cancelAppointment, // 👈 AGORA ESTÁ EXPORTADA CORRETAMENTE
};
