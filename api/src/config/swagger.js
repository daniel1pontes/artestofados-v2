module.exports = {
  swaggerDefinition: {
    openapi: '3.0.0',
    info: {
      title: 'Sistema Artestofados API',
      version: '1.0.0',
      description: 'API documentation for Sistema Artestofados and Chatbot',
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Development server',
      },
    ],
  },
  apis: ['./src/routes/*.js'],
};

