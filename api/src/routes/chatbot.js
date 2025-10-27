const express = require('express');
const router = express.Router();
const chatbotController = require('../controllers/chatbot');

/**
 * @swagger
 * /chatbot/conectar:
 *   post:
 *     summary: Connect to WhatsApp
 *     tags: [Chatbot]
 *     responses:
 *       200:
 *         description: WhatsApp client initialized
 */
router.post('/conectar', chatbotController.conectar);

/**
 * @swagger
 * /chatbot/desconectar:
 *   post:
 *     summary: Disconnect from WhatsApp
 *     tags: [Chatbot]
 *     responses:
 *       200:
 *         description: WhatsApp disconnected successfully
 */
router.post('/desconectar', chatbotController.desconectar);

/**
 * @swagger
 * /chatbot/pausar:
 *   post:
 *     summary: Pause the bot
 *     tags: [Chatbot]
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               hours:
 *                 type: number
 *                 default: 2
 *     responses:
 *       200:
 *         description: Bot paused successfully
 */
router.post('/pausar', chatbotController.pausar);

/**
 * @swagger
 * /chatbot/retomar:
 *   post:
 *     summary: Resume the bot
 *     tags: [Chatbot]
 *     responses:
 *       200:
 *         description: Bot resumed successfully
 */
router.post('/retomar', chatbotController.retomar);

/**
 * @swagger
 * /chatbot/atendimentos:
 *   get:
 *     summary: Get all atendimentos
 *     tags: [Chatbot]
 *     responses:
 *       200:
 *         description: List of atendimentos
 */
router.get('/atendimentos', chatbotController.atendimentos);

/**
 * @swagger
 * /chatbot/status:
 *   get:
 *     summary: Get bot status
 *     tags: [Chatbot]
 *     responses:
 *       200:
 *         description: Bot status
 */
router.get('/status', chatbotController.status);

/**
 * @swagger
 * /chatbot/qrcode:
 *   get:
 *     summary: Get QR code
 *     tags: [Chatbot]
 *     responses:
 *       200:
 *         description: QR code for WhatsApp connection
 */
router.get('/qrcode', chatbotController.qrCode);

module.exports = router;

