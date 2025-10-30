const express = require('express');
const controller = require('../controllers/appointments');

const router = express.Router();

// Lista últimos agendamentos
router.get('/', controller.list);

// Atualiza um agendamento (resumo, datas)
router.patch('/:id', controller.update);

// Cancela (remove) um agendamento
router.delete('/:id', controller.remove);

module.exports = router;


