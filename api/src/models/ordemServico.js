const pool = require('../config/database');

class OrdemServico {
  static async create(data) {
    const {
      clientName,
      deadline,
      payment,
      items,
      discount = 0,
      images = [],
    } = data;

    const result = await pool.query(
      `INSERT INTO ordem_servico 
       (client_name, deadline, payment, items, discount, images, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       RETURNING *`,
      [
        clientName,
        deadline,
        payment,
        JSON.stringify(items),
        discount,
        JSON.stringify(images),
      ]
    );
    return result.rows[0];
  }

  static async findById(id) {
    const result = await pool.query(
      `SELECT * FROM ordem_servico WHERE id = $1`,
      [id]
    );
    return result.rows[0];
  }

  static async findAll(search = '') {
    let query = `SELECT * FROM ordem_servico`;
    const params = [];

    if (search) {
      query += ` WHERE client_name ILIKE $1 OR id::text ILIKE $1`;
      params.push(`%${search}%`);
    }

    query += ` ORDER BY created_at DESC`;
    const result = await pool.query(query, params);
    return result.rows;
  }

  static async update(id, data) {
    const {
      clientName,
      deadline,
      payment,
      items,
      discount,
      images,
      pdfPath,
    } = data;

    const updates = [];
    const values = [];
    let paramCount = 1;

    if (clientName !== undefined) {
      updates.push(`client_name = $${paramCount}`);
      values.push(clientName);
      paramCount++;
    }
    if (deadline !== undefined) {
      updates.push(`deadline = $${paramCount}`);
      values.push(deadline);
      paramCount++;
    }
    if (payment !== undefined) {
      updates.push(`payment = $${paramCount}`);
      values.push(payment);
      paramCount++;
    }
    if (items !== undefined) {
      updates.push(`items = $${paramCount}`);
      values.push(JSON.stringify(items));
      paramCount++;
    }
    if (discount !== undefined) {
      updates.push(`discount = $${paramCount}`);
      values.push(discount);
      paramCount++;
    }
    if (images !== undefined) {
      updates.push(`images = $${paramCount}`);
      values.push(JSON.stringify(images));
      paramCount++;
    }
    if (pdfPath !== undefined) {
      updates.push(`pdf_path = $${paramCount}`);
      values.push(pdfPath);
      paramCount++;
    }
    
    updates.push(`updated_at = NOW()`);

    values.push(id);

    const result = await pool.query(
      `UPDATE ordem_servico 
       SET ${updates.join(', ')}
       WHERE id = $${paramCount}
       RETURNING *`,
      values
    );
    return result.rows[0];
  }

  static async delete(id) {
    const result = await pool.query(
      `DELETE FROM ordem_servico WHERE id = $1 RETURNING *`,
      [id]
    );
    return result.rows[0];
  }
}

module.exports = OrdemServico;

