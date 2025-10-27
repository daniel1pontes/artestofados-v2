const Cliente = require('../models/Cliente');
const OrdemServico = require('../models/ordemServico');

class ClienteController {
  async list(req, res) {
    try {
      const { limit = 100, offset = 0, search } = req.query;

      let clientes;
      if (search) {
        clientes = await Cliente.search(search, parseInt(limit), parseInt(offset));
      } else {
        clientes = await Cliente.list(parseInt(limit), parseInt(offset));
      }

      res.json({
        success: true,
        count: clientes.length,
        clientes
      });
    } catch (error) {
      console.error('Erro ao listar clientes:', error);
      res.status(500).json({
        success: false,
        message: 'Erro ao listar clientes',
        error: error.message
      });
    }
  }

  async getById(req, res) {
    try {
      const { id } = req.params;
      const cliente = await Cliente.findById(id);

      if (!cliente) {
        return res.status(404).json({
          success: false,
          message: 'Cliente não encontrado'
        });
      }

      res.json({
        success: true,
        cliente
      });
    } catch (error) {
      console.error('Erro ao buscar cliente:', error);
      res.status(500).json({
        success: false,
        message: 'Erro ao buscar cliente',
        error: error.message
      });
    }
  }

  async getOrdens(req, res) {
    try {
      const { id } = req.params;
      
      const cliente = await Cliente.findById(id);
      if (!cliente) {
        return res.status(404).json({
          success: false,
          message: 'Cliente não encontrado'
        });
      }

      const ordens = await OrdemServico.listByCliente(id);

      res.json({
        success: true,
        count: ordens.length,
        os: ordens
      });
    } catch (error) {
      console.error('Erro ao buscar ordens do cliente:', error);
      res.status(500).json({
        success: false,
        message: 'Erro ao buscar ordens de serviço',
        error: error.message
      });
    }
  }

  async create(req, res) {
    try {
      const { nome, telefone, email } = req.body;

      if (!nome || !telefone) {
        return res.status(400).json({
          success: false,
          message: 'Nome e telefone são obrigatórios'
        });
      }

      const clienteExistente = await Cliente.findByTelefone(telefone);
      if (clienteExistente) {
        return res.status(400).json({
          success: false,
          message: 'Cliente já cadastrado com este telefone'
        });
      }

      const cliente = await Cliente.create(nome, telefone, email);

      res.status(201).json({
        success: true,
        message: 'Cliente criado com sucesso',
        cliente
      });
    } catch (error) {
      console.error('Erro ao criar cliente:', error);
      res.status(500).json({
        success: false,
        message: 'Erro ao criar cliente',
        error: error.message
      });
    }
  }

  async update(req, res) {
    try {
      const { id } = req.params;
      const updates = req.body;

      const cliente = await Cliente.update(id, updates);

      if (!cliente) {
        return res.status(404).json({
          success: false,
          message: 'Cliente não encontrado'
        });
      }

      res.json({
        success: true,
        message: 'Cliente atualizado com sucesso',
        cliente
      });
    } catch (error) {
      console.error('Erro ao atualizar cliente:', error);
      res.status(500).json({
        success: false,
        message: 'Erro ao atualizar cliente',
        error: error.message
      });
    }
  }

  async delete(req, res) {
    try {
      const { id } = req.params;

      await Cliente.delete(id);

      res.json({
        success: true,
        message: 'Cliente deletado com sucesso'
      });
    } catch (error) {
      console.error('Erro ao deletar cliente:', error);
      res.status(500).json({
        success: false,
        message: 'Erro ao deletar cliente',
        error: error.message
      });
    }
  }
}

module.exports = new ClienteController();