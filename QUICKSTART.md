# 🚀 Quick Start Guide

## Início Rápido

### 1. Configurar o Banco de Dados

Certifique-se de que o PostgreSQL está rodando:

```bash
# Instalar PostgreSQL (se ainda não tiver)
# Windows: https://www.postgresql.org/download/windows/
# Mac: brew install postgresql
# Linux: sudo apt-get install postgresql

# Criar o banco de dados
createdb osdb

# Ou via psql
psql -U postgres
CREATE DATABASE osdb;
\q
```

### 2. Configurar o Backend

```bash
cd api

# Instalar dependências
npm install

# Criar arquivo .env
cp .env.example .env

# Editar o arquivo .env e adicionar suas configurações
# IMPORTANTE: Adicione sua chave da OpenAI

# Executar migrações
npm run migrate

# Iniciar servidor
npm run dev
```

O servidor estará rodando em `http://localhost:3000`

### 3. Configurar o Frontend

```bash
cd desktop

# Instalar dependências
npm install

# Criar arquivo .env
echo "REACT_APP_API_URL=http://localhost:3000" > .env

# Iniciar aplicação
npm start
```

A aplicação abrirá em `http://localhost:3000`

### 4. Testar a API

Abra o navegador e acesse:
- API Docs: `http://localhost:3000/api-docs`
- Health Check: `http://localhost:3000/health`

## 📋 Configurações Importantes

### OpenAI API Key

1. Acesse: https://platform.openai.com/api-keys
2. Crie uma nova API key
3. Adicione ao arquivo `api/.env`:
   ```
   OPENAI_API_KEY=sk-...
   ```

### Google Calendar (Opcional)

1. Crie um projeto no Google Cloud Console
2. Habilite a API do Google Calendar
3. Crie uma conta de serviço
4. Baixe a chave JSON
5. Adicione o caminho ao `.env`:
   ```
   GOOGLE_SERVICE_ACCOUNT_KEY=path/to/key.json
   ```

### Employee Numbers (Opcional)

Adicione os números dos funcionários no `.env`:
```
EMPLOYEE_NUMBERS=5511999999999,5511888888888
```

## 🐳 Usando Docker

### Opção 1: Docker Compose (Recomendado)

```bash
cd api
docker-compose up -d
```

Isso inicia tanto a API quanto o PostgreSQL.

### Opção 2: Docker Manual

```bash
cd api
docker build -t os-api .
docker run -p 3000:3000 --env-file .env os-api
```

## 🔧 Solução de Problemas

### Erro ao conectar ao banco de dados

Verifique se o PostgreSQL está rodando:
```bash
# Windows
pg_isready

# Mac/Linux
sudo systemctl status postgresql
```

### Erro no WhatsApp

1. Delete a pasta `whatsapp-session`
2. Tente conectar novamente
3. Escaneie o novo QR code

### CORS Errors

Certifique-se de que `REACT_APP_API_URL` no frontend aponta para a URL correta do backend.

## 📱 Primeiros Passos

1. **Conectar WhatsApp**: Acesse a aba "Chatbot" e clique em "Conectar WhatsApp"
2. **Escaneie o QR Code**: Use o WhatsApp do celular para escanear
3. **Criar uma OS**: Acesse a aba "Gerar OS" e preencha o formulário
4. **Visualizar OS**: Acesse a aba "Banco de OS" para ver todas as OS criadas

## 🎯 Funcionalidades Testadas

- ✅ Criação de OS com múltiplos itens
- ✅ Geração de PDF
- ✅ Pesquisa de OS
- ✅ Download de PDF
- ✅ WhatsApp connection (requer configuração)
- ✅ Chatbot com IA (requer OpenAI API key)

## 📞 Suporte

Para mais informações, consulte o arquivo `README.md`

