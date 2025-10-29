# 📅 Sistema de Agendamento - Google Calendar

## ✅ Funcionalidades Implementadas

### 1. **Verificação de Disponibilidade**
- Verifica se um horário específico está livre
- Detecta conflitos com eventos existentes
- Valida horário de trabalho (8h às 18h, segunda a sexta)

### 2. **Sugestão de Horários Alternativos**
- Sugere até 5 horários livres no mesmo dia
- Intervalos de 30 minutos
- Considera duração personalizada (padrão: 1 hora)

### 3. **Criação de Eventos com Validação**
- Valida disponibilidade antes de criar
- Retorna sugestões se horário não estiver disponível
- Cria evento automaticamente no Google Calendar

## 🚀 Como Usar

### Endpoints da API

#### 1. Verificar Disponibilidade
```bash
POST /api/calendar/availability
Content-Type: application/json

{
  "startTime": "2024-01-15T14:00:00",
  "endTime": "2024-01-15T15:00:00"
}
```

**Resposta:**
```json
{
  "available": true,
  "conflicts": 0,
  "message": "Horário disponível"
}
```

#### 2. Sugerir Horários Alternativos
```bash
POST /api/calendar/suggest
Content-Type: application/json

{
  "requestedTime": "2024-01-15T14:00:00",
  "duration": 60
}
```

**Resposta:**
```json
{
  "requestedTime": "2024-01-15T14:00:00",
  "suggestions": [
    {
      "start": "2024-01-15T08:00:00.000Z",
      "end": "2024-01-15T09:00:00.000Z",
      "formatted": "15/01/2024 08:00:00 - 15/01/2024 09:00:00"
    }
  ],
  "count": 1
}
```

#### 3. Criar Evento
```bash
POST /api/calendar/event
Content-Type: application/json

{
  "summary": "Reunião com Cliente",
  "description": "Discussão sobre projeto de estofados",
  "startTime": "2024-01-15T14:00:00",
  "endTime": "2024-01-15T15:00:00"
}
```

**Resposta de Sucesso:**
```json
{
  "success": true,
  "event": {
    "id": "event_id_123",
    "summary": "Reunião com Cliente",
    "start": "2024-01-15T14:00:00-03:00",
    "end": "2024-01-15T15:00:00-03:00",
    "htmlLink": "https://calendar.google.com/event?eid=..."
  },
  "message": "Evento criado com sucesso"
}
```

**Resposta de Conflito:**
```json
{
  "error": "Horário não disponível",
  "details": "Horário não disponível. Conflitos encontrados: 1. Sugestões de horários alternativos: 3 opções disponíveis.",
  "suggestions": [
    {
      "start": "2024-01-15T08:00:00.000Z",
      "end": "2024-01-15T09:00:00.000Z",
      "formatted": "15/01/2024 08:00:00 - 15/01/2024 09:00:00"
    }
  ]
}
```

#### 4. Verificar Horário de Trabalho
```bash
POST /api/calendar/working-hours
Content-Type: application/json

{
  "dateTime": "2024-01-15T14:00:00"
}
```

**Resposta:**
```json
{
  "dateTime": "2024-01-15T14:00:00.000Z",
  "isWorkingHours": true,
  "dayOfWeek": "segunda-feira",
  "hour": 14,
  "message": "Horário dentro do expediente"
}
```

## 🔧 Configurações

### Horário de Trabalho
- **Dias**: Segunda a sexta-feira
- **Horário**: 8h às 18h
- **Duração padrão**: 1 hora por reunião

### Validações Automáticas
1. ✅ Horário dentro do expediente
2. ✅ Dia da semana válido (segunda a sexta)
3. ✅ Verificação de conflitos
4. ✅ Sugestões automáticas se indisponível

## 🧪 Testando

### Script de Teste
```bash
cd api
node test-calendar.js
```

### Teste via API
```bash
# Verificar disponibilidade
curl -X POST http://localhost:3000/api/calendar/availability \
  -H "Content-Type: application/json" \
  -d '{"startTime":"2024-01-15T14:00:00","endTime":"2024-01-15T15:00:00"}'

# Criar evento
curl -X POST http://localhost:3000/api/calendar/event \
  -H "Content-Type: application/json" \
  -d '{"summary":"Teste","startTime":"2024-01-15T14:00:00","endTime":"2024-01-15T15:00:00"}'
```

## 📚 Documentação Swagger

Acesse a documentação completa em:
```
http://localhost:3000/api-docs
```

## ⚠️ Requisitos

1. **Credenciais do Google Calendar** configuradas
2. **Arquivo JSON** do Service Account na pasta `credentials/`
3. **API do Google Calendar** habilitada no Google Cloud Console

## 🎯 Exemplo de Integração no Chatbot

```javascript
// No seu chatbot, você pode usar assim:
const { createCalendarEventWithValidation } = require('./config/google-calendar');

async function agendarReuniao(cliente, dataHora) {
  try {
    const startTime = new Date(dataHora);
    const endTime = new Date(startTime.getTime() + 60 * 60000); // +1 hora
    
    const evento = await createCalendarEventWithValidation(
      `Reunião com ${cliente}`,
      `Reunião agendada via chatbot`,
      startTime,
      endTime
    );
    
    return `✅ Reunião agendada com sucesso para ${startTime.toLocaleString('pt-BR')}`;
    
  } catch (error) {
    if (error.message.includes('Horário não disponível')) {
      return `❌ Horário não disponível. ${error.message}`;
    }
    return `❌ Erro ao agendar: ${error.message}`;
  }
}
```

## 🔒 Segurança

- ✅ Credenciais protegidas no `.gitignore`
- ✅ Validação de horário de trabalho
- ✅ Verificação de conflitos
- ✅ Tratamento de erros robusto
