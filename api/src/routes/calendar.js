const express = require('express');
const calendarController = require('../controllers/calendar');

const router = express.Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     CalendarEvent:
 *       type: object
 *       required:
 *         - summary
 *         - startTime
 *       properties:
 *         summary:
 *           type: string
 *           description: Título do evento
 *         description:
 *           type: string
 *           description: Descrição do evento
 *         startTime:
 *           type: string
 *           format: date-time
 *           description: Data e hora de início (ISO 8601)
 *         endTime:
 *           type: string
 *           format: date-time
 *           description: Data e hora de término (ISO 8601)
 *         duration:
 *           type: integer
 *           description: Duração em minutos (padrão 60)
 *     AvailabilityCheck:
 *       type: object
 *       required:
 *         - startTime
 *         - endTime
 *       properties:
 *         startTime:
 *           type: string
 *           format: date-time
 *           description: Data e hora de início
 *         endTime:
 *           type: string
 *           format: date-time
 *           description: Data e hora de término
 *     TimeSuggestion:
 *       type: object
 *       required:
 *         - requestedTime
 *       properties:
 *         requestedTime:
 *           type: string
 *           format: date-time
 *           description: Data e hora solicitada
 *         duration:
 *           type: integer
 *           description: Duração em minutos (padrão 60)
 */

/**
 * @swagger
 * /api/calendar/availability:
 *   post:
 *     summary: Verificar disponibilidade de horário
 *     tags: [Calendar]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AvailabilityCheck'
 *     responses:
 *       200:
 *         description: Verificação realizada com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 available:
 *                   type: boolean
 *                 conflicts:
 *                   type: integer
 *                 message:
 *                   type: string
 *       400:
 *         description: Dados inválidos
 *       500:
 *         description: Erro interno do servidor
 */
router.post('/availability', calendarController.checkAvailability);

/**
 * @swagger
 * /api/calendar/suggest:
 *   post:
 *     summary: Sugerir horários alternativos
 *     tags: [Calendar]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TimeSuggestion'
 *     responses:
 *       200:
 *         description: Sugestões geradas com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 requestedTime:
 *                   type: string
 *                 suggestions:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       start:
 *                         type: string
 *                       end:
 *                         type: string
 *                       formatted:
 *                         type: string
 *                 count:
 *                   type: integer
 *       400:
 *         description: Dados inválidos
 *       500:
 *         description: Erro interno do servidor
 */
router.post('/suggest', calendarController.suggestTimes);

/**
 * @swagger
 * /api/calendar/event:
 *   post:
 *     summary: Criar evento no calendário
 *     tags: [Calendar]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CalendarEvent'
 *     responses:
 *       200:
 *         description: Evento criado com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 event:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     summary:
 *                       type: string
 *                     start:
 *                       type: string
 *                     end:
 *                       type: string
 *                     htmlLink:
 *                       type: string
 *                 message:
 *                   type: string
 *       409:
 *         description: Horário não disponível
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                 details:
 *                   type: string
 *                 suggestions:
 *                   type: array
 *       400:
 *         description: Dados inválidos
 *       500:
 *         description: Erro interno do servidor
 */
router.post('/event', calendarController.createEvent);

/**
 * @swagger
 * /api/calendar/working-hours:
 *   post:
 *     summary: Verificar se horário está dentro do expediente
 *     tags: [Calendar]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - dateTime
 *             properties:
 *               dateTime:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       200:
 *         description: Verificação realizada com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 dateTime:
 *                   type: string
 *                 isWorkingHours:
 *                   type: boolean
 *                 dayOfWeek:
 *                   type: string
 *                 hour:
 *                   type: integer
 *                 message:
 *                   type: string
 *       400:
 *         description: Dados inválidos
 *       500:
 *         description: Erro interno do servidor
 */
router.post('/working-hours', calendarController.checkWorkingHours);

module.exports = router;
