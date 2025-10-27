const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Artestofados API',
      version: '2.0.0',
      description: 'API REST completa para gestão da Artestofados - fabricação e reforma de estofados',
      contact: {
        name: 'Suporte Artestofados',
        email: 'suporte@artestofados.com.br'
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT'
      }
    },
    servers: [
      {
        url: 'http://localhost:3000/api/v1',
        description: 'Servidor de Desenvolvimento'
      },
      {
        url: 'https://api.artestofados.com.br/api/v1',
        description: 'Servidor de Produção'
      }
    ],
    tags: [
      {
        name: 'Chatbot',
        description: 'Gerenciamento do chatbot WhatsApp'
      },
      {
        name: 'Ordens de Serviço',
        description: 'Operações de CRUD para ordens de serviço'
      },
      {
        name: 'Clientes',
        description: 'Gerenciamento de clientes'
      },
      {
        name: 'Calendário',
        description: 'Agendamento e gerenciamento de visitas'
      },
      {
        name: 'Health',
        description: 'Verificação de saúde da API'
      }
    ],
    components: {
      schemas: {
        Cliente: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
              description: 'ID único do cliente'
            },
            nome: {
              type: 'string',
              description: 'Nome completo do cliente'
            },
            telefone: {
              type: 'string',
              description: 'Telefone do cliente'
            },
            email: {
              type: 'string',
              format: 'email',
              description: 'Email do cliente'
            },
            created_at: {
              type: 'string',
              format: 'date-time',
              description: 'Data de criação'
            }
          }
        },
        OrdemServico: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              format: 'uuid'
            },
            numero_os: {
              type: 'integer',
              description: 'Número sequencial da OS'
            },
            cliente_id: {
              type: 'string',
              format: 'uuid'
            },
            prazo_entrega: {
              type: 'string',
              format: 'date'
            },
            forma_pagamento: {
              type: 'string'
            },
            desconto_total: {
              type: 'number',
              format: 'double'
            },
            valor_total: {
              type: 'number',
              format: 'double'
            },
            status: {
              type: 'string',
              enum: ['pendente', 'em_andamento', 'concluido', 'cancelado']
            },
            imagem_projeto: {
              type: 'string',
              nullable: true
            },
            created_at: {
              type: 'string',
              format: 'date-time'
            }
          }
        },
        ItemOS: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              format: 'uuid'
            },
            quantidade: {
              type: 'integer'
            },
            descricao: {
              type: 'string'
            },
            valor_unitario: {
              type: 'number',
              format: 'double'
            },
            desconto: {
              type: 'number',
              format: 'double'
            },
            valor_total: {
              type: 'number',
              format: 'double'
            }
          }
        },
        SessaoChatbot: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              format: 'uuid'
            },
            telefone: {
              type: 'string'
            },
            etapa: {
              type: 'string'
            },
            tipo_servico: {
              type: 'string',
              enum: ['fabricacao', 'reforma']
            },
            tipo_estofado: {
              type: 'string'
            },
            ativo: {
              type: 'boolean'
            },
            created_at: {
              type: 'string',
              format: 'date-time'
            }
          }
        },
        Error: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: false
            },
            message: {
              type: 'string'
            },
            error: {
              type: 'string'
            }
          }
        }
      },
      responses: {
        BadRequest: {
          description: 'Requisição inválida',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              }
            }
          }
        },
        NotFound: {
          description: 'Recurso não encontrado',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              }
            }
          }
        },
        InternalError: {
          description: 'Erro interno do servidor',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              }
            }
          }
        }
      }
    }
  },
  apis: ['./src/routes/*.js', './src/server.js']
};

module.exports = swaggerJsdoc(options);