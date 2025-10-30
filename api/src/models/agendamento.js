const pool = require('../config/database');

function normalizeAgendaType(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'reuniao' || t === 'online') return 'online';
  if (t === 'visita' || t === 'presencial' || t === 'loja') return 'loja';
  return t;
}

async function createAppointment({ calendarEventId, summary, description = '', startTime, endTime, agendaType, clientName, phoneNumber }) {
  // Guard: evitar sobreposição por mesmo tipo diretamente no banco
  const normalizedType = normalizeAgendaType(agendaType);
  const conflicts = await findConflicts(startTime, endTime, normalizedType);
  if (conflicts.length > 0) {
    const error = new Error('conflict: overlapping appointment for same agendaType');
    error.code = 'APPT_CONFLICT';
    throw error;
  }
  const result = await pool.query(
    `INSERT INTO appointments (calendar_event_id, summary, description, start_time, end_time, agenda_type, client_name, phone_number, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
     RETURNING id`,
    [calendarEventId || null, summary, description, startTime, endTime, normalizedType, clientName || null, phoneNumber || null]
  );
  return result.rows[0].id;
}

async function findConflicts(startTime, endTime, agendaType) {
  const normalized = normalizeAgendaType(agendaType);
  // Considerar sinônimos antigos salvos no banco
  const typeSet = normalized === 'online' 
    ? ['online'] 
    : ['loja', 'visita', 'presencial'];
  const result = await pool.query(
    `SELECT id, summary, start_time, end_time, agenda_type
       FROM appointments
      WHERE agenda_type = ANY($1)
        AND start_time < $3
        AND end_time   > $2
      ORDER BY start_time ASC`,
    [typeSet, startTime, endTime]
  );
  return result.rows;
}

async function findLatestByPhone(phoneNumber) {
  const result = await pool.query(
    `SELECT * FROM appointments
      WHERE phone_number = $1
      ORDER BY start_time DESC
      LIMIT 1`,
    [phoneNumber]
  );
  return result.rows[0] || null;
}

module.exports = {
  createAppointment,
  findConflicts,
  findLatestByPhone,
};


