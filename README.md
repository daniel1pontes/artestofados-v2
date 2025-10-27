# OS Management System

Sistema completo de gestão de Ordens de Serviço (OS) com chatbot integrado ao WhatsApp, geração de PDF, e interface web minimalista.

## 🎯 Funcionalidades

### 1. Chatbot com IA
- Conexão via WhatsApp com QR Code
- Classificação automática de solicitações (Fabricação/Reforma)
- Integração com OpenAI para respostas inteligentes
- Pausa automática de 2h quando funcionário envia mensagem
- Integração com Google Calendar para criar eventos
- Endpoints para controle: conectar, desconectar, pausar, retomar

### 2. Gerador de OS
- Campos: nome do cliente, prazo, pagamento, itens (com quantidade, valor unitário e total), desconto
- Adição dinâmica de múltiplos itens e imagens
- Geração automática de PDF
- Cálculo automático de totais

### 3. Banco de OS
- Listagem de todas as OS
- Pesquisa por nome do cliente ou número da OS
- Visualização detalhada de OS
- Download de PDF

## 🛠️ Tecnologias

### Backend
- Node.js + Express
- PostgreSQL
- whatsapp-web.js (WhatsApp)
- OpenAI API
- Google Calendar API
- PDFKit (geração de PDF)

### Frontend
- React
- Axios (HTTP client)
- CSS3 (design minimalista)

## 📦 Instalação

### Pré-requisitos
- Node.js 18+
- PostgreSQL 15+
- Docker (opcional)

### Backend

1. Navegue até a pasta `api`
```bash
cd api
```

2. Instale as dependências
```bash
npm install
```

3. Configure as variáveis de ambiente
```bash
cp .env.example .env
```

Edite o arquivo `.env`:
```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=osdb
DB_USER=postgres
DB_PASSWORD=postgres

PORT=3000
NODE_ENV=development

OPENAI_API_KEY=sua_chave_aqui
GOOGLE_SERVICE_ACCOUNT_KEY=caminho/para/service-account-key.json
EMPLOYEE_NUMBERS=5511999999999,5511888888888
```

4. Execute as migrações
```bash
npm run migrate
```

5. Inicie o servidor
```bash
npm run dev
```

O servidor estará rodando em `http://localhost:3000`

### Frontend

1. Navegue até a pasta `desktop`
```bash
cd desktop
```

2. Instale as dependências
```bash
npm install
```

3. Configure a URL da API em `.env`
```env
REACT_APP_API_URL=http://localhost:3000
```

4. Inicie o servidor de desenvolvimento
```bash
npm start
```

A aplicação estará rodando em `http://localhost:3000`

## 🐳 Docker

### Rodar com Docker Compose

1. Na pasta `api`, execute:
```bash
docker-compose up -d
```

Isso iniciará automaticamente:
- API na porta 3000
- PostgreSQL na porta 5432

### Construir manualmente

```bash
cd api
docker build -t os-api .
docker run -p 3000:3000 os-api
```

## 📚 Endpoints da API

### Chatbot
- `POST /chatbot/conectar` - Conectar WhatsApp
- `POST /chatbot/desconectar` - Desconectar WhatsApp
- `POST /chatbot/pausar` - Pausar bot
- `POST /chatbot/retomar` - Retomar bot
- `GET /chatbot/atendimentos` - Listar atendimentos
- `GET /chatbot/status` - Obter status
- `GET /chatbot/qrcode` - Obter QR code

### OS
- `POST /os/criar` - Criar nova OS
- `GET /os` - Listar OS (com pesquisa opcional)
- `GET /os/:id` - Obter OS por ID
- `GET /os/:id/download` - Baixar PDF da OS
- `PUT /os/:id` - Atualizar OS
- `DELETE /os/:id` - Deletar OS

Documentação completa disponível em `/api-docs` quando o servidor estiver rodando.

## 🎨 Interface

A interface segue um design minimalista:
- Cor predominante: branco
- Detalhes em cinza claro
- Sidebar com navegação entre as 3 principais funcionalidades
- Layout responsivo e limpo

## 🔒 Segurança

- Validação de dados em todos os endpoints
- Tratamento de erros
- Sanitização de inputs
- HTTPS recomendado para produção
- Rate limiting (configurado via express-rate-limit)

## 🏗️ Estrutura do Projeto

```
artestofados-v2/
├── api/
│   ├── src/
│   │   ├── config/        # Configurações (database, OpenAI, Calendar)
│   │   ├── controllers/   # Controllers dos endpoints
│   │   ├── models/        # Modelos do banco de dados
│   │   ├── routes/        # Definição de rotas
│   │   ├── services/        # Serviços (WhatsApp, PDF)
│   │   └── server.js      # Servidor principal
│   ├── Dockerfile
│   └── docker-compose.yml
└── desktop/
    ├── src/
    │   ├── components/    # Componentes React
    │   ├── pages/         # Páginas da aplicação
    │   ├── services/      # Serviços (API client)
    │   ├── styles/        # Estilos globais
    │   └── App.js         # Componente principal
    └── public/
```

## 🧪 Clean Code

O projeto segue boas práticas de Clean Code:
- Funções pequenas e focadas
- Nomes claros e descritivos
- Sem duplicação de código
- Separação de responsabilidades
- Modularidade

## 📝 Licença

ISC

## 👥 Autor

Sistema desenvolvido para gestão de Ordens de Serviço com integração WhatsApp e IA.

