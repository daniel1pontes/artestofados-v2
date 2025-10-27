module.exports = {
  swaggerDefinition: {
    openapi: '3.0.0',
    info: {
      title: 'OS Management API',
      version: '1.0.0',
      description: 'API documentation for OS Management and Chatbot',
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

