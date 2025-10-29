/**
 * Script de teste para funcionalidades do Google Calendar
 * Execute com: node test-calendar.js
 */

const { 
  createCalendarEventWithValidation, 
  checkTimeSlotAvailability, 
  suggestAlternativeTimes,
  isWithinWorkingHours 
} = require('./src/config/google-calendar');

async function testCalendarFunctions() {
  console.log('🧪 Testando funcionalidades do Google Calendar...\n');

  // Teste 1: Verificar horário de trabalho
  console.log('1️⃣ Testando verificação de horário de trabalho:');
  
  const workingTime = new Date('2024-01-15T10:00:00'); // Segunda, 10h
  const nonWorkingTime = new Date('2024-01-15T20:00:00'); // Segunda, 20h
  const weekendTime = new Date('2024-01-13T10:00:00'); // Sábado, 10h

  console.log(`   Segunda 10h: ${isWithinWorkingHours(workingTime) ? '✅' : '❌'}`);
  console.log(`   Segunda 20h: ${isWithinWorkingHours(nonWorkingTime) ? '✅' : '❌'}`);
  console.log(`   Sábado 10h: ${isWithinWorkingHours(weekendTime) ? '✅' : '❌'}\n`);

  // Teste 2: Verificar disponibilidade (simulado)
  console.log('2️⃣ Testando verificação de disponibilidade:');
  
  try {
    const startTime = new Date('2024-01-15T14:00:00');
    const endTime = new Date('2024-01-15T15:00:00');
    
    console.log(`   Verificando disponibilidade para ${startTime.toLocaleString('pt-BR')} - ${endTime.toLocaleString('pt-BR')}`);
    
    const availability = await checkTimeSlotAvailability(startTime, endTime);
    console.log(`   Disponível: ${availability.available ? '✅' : '❌'}`);
    console.log(`   Conflitos: ${availability.conflicts.length}\n`);
    
  } catch (error) {
    console.log(`   ❌ Erro: ${error.message}\n`);
  }

  // Teste 3: Sugerir horários alternativos
  console.log('3️⃣ Testando sugestão de horários alternativos:');
  
  try {
    const requestedTime = new Date('2024-01-15T14:00:00');
    console.log(`   Horário solicitado: ${requestedTime.toLocaleString('pt-BR')}`);
    
    const suggestions = await suggestAlternativeTimes(requestedTime, 60);
    console.log(`   Sugestões encontradas: ${suggestions.length}`);
    
    suggestions.forEach((suggestion, index) => {
      console.log(`   ${index + 1}. ${suggestion.start.toLocaleString('pt-BR')} - ${suggestion.end.toLocaleString('pt-BR')}`);
    });
    console.log('');
    
  } catch (error) {
    console.log(`   ❌ Erro: ${error.message}\n`);
  }

  // Teste 4: Criar evento com validação
  console.log('4️⃣ Testando criação de evento com validação:');
  
  try {
    const eventStart = new Date('2024-01-15T16:00:00');
    const eventEnd = new Date('2024-01-15T17:00:00');
    
    console.log(`   Criando evento: ${eventStart.toLocaleString('pt-BR')} - ${eventEnd.toLocaleString('pt-BR')}`);
    
    const event = await createCalendarEventWithValidation(
      'Reunião de Teste - Artestofados',
      'Reunião para discussão de projeto',
      eventStart,
      eventEnd
    );
    
    console.log(`   ✅ Evento criado com sucesso!`);
    console.log(`   ID: ${event.id}`);
    console.log(`   Link: ${event.htmlLink}\n`);
    
  } catch (error) {
    console.log(`   ❌ Erro: ${error.message}\n`);
  }

  console.log('🏁 Testes concluídos!');
}

// Executar testes se o arquivo for executado diretamente
if (require.main === module) {
  testCalendarFunctions().catch(console.error);
}

module.exports = { testCalendarFunctions };
