const pool = require('../config/database');

class SessaoChatbot {
  static async create(phoneNumber, state = 'initial', metadata = {}) {
    const result = await pool.query(
      `INSERT INTO sessions (phone_number, state, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       RETURNING *`,
      [phoneNumber, state, JSON.stringify(metadata)]
    );
    return result.rows[0];
  }

  static async findByPhone(phoneNumber) {
    const result = await pool.query(
      `SELECT * FROM sessions WHERE phone_number = $1 ORDER BY created_at DESC LIMIT 1`,
      [phoneNumber]
    );
    return result.rows[0];
  }

  static async findById(id) {
    const result = await pool.query(
      `SELECT * FROM sessions WHERE id = $1`,
      [id]
    );
    return result.rows[0];
  }

  static async update(id, data) {
    const { state, metadata } = data;
    const result = await pool.query(
      `UPDATE sessions 
       SET state = $1, metadata = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [state, JSON.stringify(metadata), id]
    );
    return result.rows[0];
  }

  static async getAll() {
    const result = await pool.query(
      `SELECT * FROM sessions ORDER BY created_at DESC`
    );
    return result.rows;
  }
}

module.exports = SessaoChatbot;

