const pool = require('../config/database');

async function runMigrations() {
  try {
    console.log('Running database migrations...');

    // Sessions table for chatbot
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id SERIAL PRIMARY KEY,
        phone_number VARCHAR(20) NOT NULL,
        state VARCHAR(50) DEFAULT 'initial',
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Messages table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id VARCHAR(100) PRIMARY KEY,
        from_number VARCHAR(20) NOT NULL,
        body TEXT,
        timestamp BIGINT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // OS table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ordem_servico (
        id SERIAL PRIMARY KEY,
        client_name VARCHAR(255) NOT NULL,
        deadline VARCHAR(100),
        payment VARCHAR(100),
        items JSONB DEFAULT '[]',
        discount DECIMAL(10, 2) DEFAULT 0,
        images JSONB DEFAULT '[]',
        pdf_path VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create indexes
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_sessions_phone ON sessions(phone_number)
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_os_client_name ON ordem_servico(client_name)
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_os_created_at ON ordem_servico(created_at)
    `);

    console.log('Migrations completed successfully');
  } catch (error) {
    console.error('Error running migrations:', error);
    throw error;
  }
}

async function seedDatabase() {
  try {
    console.log('Seeding database...');
    // Add any seed data if needed
    console.log('Database seeding completed');
  } catch (error) {
    console.error('Error seeding database:', error);
    throw error;
  }
}

async function main() {
  try {
    await runMigrations();
    await seedDatabase();
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { runMigrations, seedDatabase };

