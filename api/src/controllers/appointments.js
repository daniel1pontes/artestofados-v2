const { google } = require('googleapis');
const pool = require('../config/database');
const { createAppointment, findConflicts } = require('../models/agendamento');
const { getAuthClient } = require('../config/google-calendar');

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

async function list(req, res) {
  try {
    const result = await pool.query(
      `SELECT id, calendar_event_id, summary, start_time, end_time, agenda_type, client_name
         FROM appointments
        ORDER BY start_time DESC
        LIMIT 200`
    );
    res.json({ items: result.rows });
  } catch (error) {
    console.error('Error listing appointments:', error);
    res.status(500).json({ error: 'Erro ao listar agendamentos' });
  }
}

async function update(req, res) {
  try {
    const { id } = req.params;
    const { summary, startTime, endTime } = req.body;

    const fetch = await pool.query(`SELECT * FROM appointments WHERE id = $1`, [id]);
    if (fetch.rows.length === 0) return res.status(404).json({ error: 'Agendamento não encontrado' });
    const appt = fetch.rows[0];

    const newStart = startTime ? parseBrazilDateTime(startTime) : new Date(appt.start_time);
    const newEnd = endTime ? parseBrazilDateTime(endTime) : new Date(appt.end_time);

    // Checar conflitos no banco (mesmo tipo)
    const conflicts = await findConflicts(newStart, newEnd, normalizeAgendaType(appt.agenda_type));
    const conflictsFiltered = conflicts.filter(c => c.id !== appt.id);
    if (conflictsFiltered.length > 0) {
      return res.status(409).json({ error: 'Horário não disponível para este tipo' });
    }

    // Atualizar Google Calendar se houver id
    if (appt.calendar_event_id) {
      const auth = getAuthClient();
      const calendar = google.calendar({ version: 'v3', auth });

      await calendar.events.patch({
        calendarId: 'primary',
        eventId: appt.calendar_event_id,
        resource: {
          summary: summary || appt.summary,
          start: { dateTime: newStart.toISOString(), timeZone: 'America/Sao_Paulo' },
          end: { dateTime: newEnd.toISOString(), timeZone: 'America/Sao_Paulo' },
        },
      });
    }

    const upd = await pool.query(
      `UPDATE appointments
          SET summary = COALESCE($2, summary),
              start_time = $3,
              end_time = $4,
              updated_at = NOW()
        WHERE id = $1
      RETURNING id, calendar_event_id, summary, start_time, end_time, agenda_type, client_name`,
      [id, summary || null, newStart, newEnd]
    );

    res.json({ success: true, item: upd.rows[0] });
  } catch (error) {
    console.error('Error updating appointment:', error);
    res.status(500).json({ error: 'Erro ao atualizar agendamento' });
  }
}

async function remove(req, res) {
  try {
    const { id } = req.params;
    const fetch = await pool.query(`SELECT * FROM appointments WHERE id = $1`, [id]);
    if (fetch.rows.length === 0) return res.status(404).json({ error: 'Agendamento não encontrado' });
    const appt = fetch.rows[0];

    // Remover do Google Calendar
    if (appt.calendar_event_id) {
      try {
        const { getAuthClient } = require('../config/google-calendar');
        const auth = getAuthClient();
        const calendar = google.calendar({ version: 'v3', auth });
        await calendar.events.delete({ calendarId: 'primary', eventId: appt.calendar_event_id });
      } catch (err) {
        console.error('⚠️ Could not delete calendar event:', err.message);
      }
    }

    await pool.query(`DELETE FROM appointments WHERE id = $1`, [id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting appointment:', error);
    res.status(500).json({ error: 'Erro ao deletar agendamento' });
  }
}

module.exports = { list, update, remove };


