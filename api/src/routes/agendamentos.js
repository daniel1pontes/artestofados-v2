const express = require('express');
const { listUpcomingEvents } = require('../services/calendarService');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { from, to, tipo, order, limit } = req.query;
    const items = await listUpcomingEvents({ from, to, tipo, order, limit: limit ? Number(limit) : 500 });
    res.json({ items });
  } catch (error) {
    console.error('❌ Error listing upcoming:', error);
    res.status(500).json({ error: 'Erro ao listar agendamentos' });
  }
});

module.exports = router;


