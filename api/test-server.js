const express = require('express');
const cors = require('cors');

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Debug middleware
app.use((req, res, next) => {
  console.log(`📡 ${req.method} ${req.path}`);
  next();
});

// Test routes
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/chatbot/status', (req, res) => {
  res.json({ 
    status: 'disconnected',
    message: 'Test server working',
    timestamp: new Date().toISOString()
  });
});

app.get('/os', (req, res) => {
  res.json({ 
    osList: [],
    message: 'Test server working',
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use((req, res) => {
  console.log(`❌ 404: ${req.method} ${req.path}`);
  res.status(404).json({ error: 'Route not found' });
});

app.listen(PORT, () => {
  console.log(`🧪 Test server running on port ${PORT}`);
  console.log('Available routes:');
  console.log('  GET /health');
  console.log('  GET /chatbot/status');
  console.log('  GET /os');
});
