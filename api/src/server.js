require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');
const path = require('path');
const swaggerSpec = require('./config/swagger');

const app = express();
const PORT = process.env.PORT || 3000;
const API_VERSION = process.env.API_VERSION || 'v1';

// Middleware de segurança
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: 'Muitas requisições deste IP, tente novamente mais tarde.'
});

app.use('/api/', limiter);

// CORS
const corsOptions = {
  origin: process.env.CORS_ORIGIN || 'http://localhost:4000',
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// Middleware de parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(compression());

// Logging
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// Arquivos estáticos
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Verifica a saúde da API
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: API está funcionando
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 version:
 *                   type: string
 *                   example: v1
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: API_VERSION,
    environment: process.env.NODE_ENV || 'development'
  });
});

// Documentação Swagger
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Artestofados API Documentation'
}));

// Rota para spec JSON
app.get('/api-docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

// Rotas da API
try {
  const chatbotRoutes = require('./routes/chatbot');
  const osRoutes = require('./routes/os');
  const clienteRoutes = require('./routes/clientes');
  const calendarRoutes = require('./routes/calendar');

  app.use(`/api/${API_VERSION}/chatbot`, chatbotRoutes);
  app.use(`/api/${API_VERSION}/os`, osRoutes);
  app.use(`/api/${API_VERSION}/clientes`, clienteRoutes);
  app.use(`/api/${API_VERSION}/calendar`, calendarRoutes);
} catch (error) {
  console.error('⚠️ Erro ao carregar rotas:', error.message);
}

// Rota 404
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Rota não encontrada',
    path: req.path
  });
});

// Tratamento de erros global
app.use((err, req, res, next) => {
  console.error('Erro na aplicação:', err);
  
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Erro interno do servidor';
  
  res.status(statusCode).json({
    success: false,
    message,
    error: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// Iniciar servidor
const server = app.listen(PORT, () => {
  console.log('🚀 ========================================');
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`📍 Ambiente: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📚 Documentação: http://localhost:${PORT}/api-docs`);
  console.log(`🏥 Health Check: http://localhost:${PORT}/health`);
  console.log('🚀 ========================================');
});

// Tratamento de erros não capturados
process.on('uncaughtException', (error) => {
  console.error('❌ Erro não capturado:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Promise rejeitada não tratada:', reason);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('📤 SIGTERM recebido, encerrando gracefully...');
  server.close(() => {
    console.log('✅ Servidor encerrado');
    process.exit(0);
  });
});

module.exports = app;