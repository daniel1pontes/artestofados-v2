const OrdemServico = require('../models/ordemServico');
const pdfService = require('../services/pdf');

const osController = {
  async criar(req, res) {
    try {
      const { clientName, deadline, payment, items, discount, images } = req.body;

      // Validation
      if (!clientName || !deadline || !payment || !items || items.length === 0) {
        return res.status(400).json({ 
          error: 'Missing required fields: clientName, deadline, payment, items' 
        });
      }

      // Validate items structure
      for (const item of items) {
        if (!item.description || !item.quantity || !item.unitValue) {
          return res.status(400).json({ 
            error: 'Each item must have: description, quantity, unitValue' 
          });
        }
        // Calculate total if not provided
        if (!item.total) {
          item.total = (parseFloat(item.quantity) * parseFloat(item.unitValue)).toFixed(2);
        }
      }

      // Create OS
      const osData = await OrdemServico.create({
        clientName,
        deadline,
        payment,
        items,
        discount: discount || 0,
        images: images || [],
      });

      // Generate PDF
      const pdf = await pdfService.generateOSPDF({
        ...osData,
        items: osData.items,
        images: osData.images,
      });

      // Update OS with PDF path
      await OrdemServico.update(osData.id, {
        pdfPath: pdf.filename,
      });

      res.json({
        message: 'OS created successfully',
        os: osData,
        pdf: {
          filename: pdf.filename,
          path: `/uploads/${pdf.filename}`,
        },
      });
    } catch (error) {
      console.error('Error creating OS:', error);
      res.status(500).json({ error: 'Failed to create OS' });
    }
  },

  async listar(req, res) {
    try {
      const { search } = req.query;
      const osList = await OrdemServico.findAll(search);

      const formattedList = osList.map(os => ({
        id: os.id,
        clientName: os.client_name,
        deadline: os.deadline,
        payment: os.payment,
        items: os.items,
        discount: os.discount,
        images: os.images,
        pdfPath: os.pdf_path,
        createdAt: os.created_at,
        updatedAt: os.updated_at,
      }));

      res.json({ osList: formattedList });
    } catch (error) {
      console.error('Error listing OS:', error);
      res.status(500).json({ error: 'Failed to list OS' });
    }
  },

  async obter(req, res) {
    try {
      const { id } = req.params;
      const os = await OrdemServico.findById(id);

      if (!os) {
        return res.status(404).json({ error: 'OS not found' });
      }

      const formatted = {
        id: os.id,
        clientName: os.client_name,
        deadline: os.deadline,
        payment: os.payment,
        items: os.items,
        discount: os.discount,
        images: os.images,
        pdfPath: os.pdf_path,
        createdAt: os.created_at,
        updatedAt: os.updated_at,
      };

      res.json({ os: formatted });
    } catch (error) {
      console.error('Error getting OS:', error);
      res.status(500).json({ error: 'Failed to get OS' });
    }
  },

  async download(req, res) {
    try {
      const { id } = req.params;
      const os = await OrdemServico.findById(id);

      if (!os) {
        return res.status(404).json({ error: 'OS not found' });
      }

      if (!os.pdf_path) {
        return res.status(404).json({ error: 'PDF not generated yet' });
      }

      const path = require('path');
      const fs = require('fs');
      const filepath = path.join(__dirname, '../../uploads', os.pdf_path);

      if (!fs.existsSync(filepath)) {
        return res.status(404).json({ error: 'PDF file not found' });
      }

      res.download(filepath, `${os.pdf_path}`, (err) => {
        if (err) {
          console.error('Error downloading PDF:', err);
          res.status(500).json({ error: 'Failed to download PDF' });
        }
      });
    } catch (error) {
      console.error('Error downloading OS:', error);
      res.status(500).json({ error: 'Failed to download OS' });
    }
  },

  async atualizar(req, res) {
    try {
      const { id } = req.params;
      const { clientName, deadline, payment, items, discount, images } = req.body;

      const os = await OrdemServico.findById(id);
      if (!os) {
        return res.status(404).json({ error: 'OS not found' });
      }

      const updated = await OrdemServico.update(id, {
        clientName: clientName || os.client_name,
        deadline: deadline || os.deadline,
        payment: payment || os.payment,
        items: items || os.items,
        discount: discount !== undefined ? discount : os.discount,
        images: images || os.images,
      });

      res.json({ message: 'OS updated successfully', os: updated });
    } catch (error) {
      console.error('Error updating OS:', error);
      res.status(500).json({ error: 'Failed to update OS' });
    }
  },

  async deletar(req, res) {
    try {
      const { id } = req.params;
      const os = await OrdemServico.delete(id);

      if (!os) {
        return res.status(404).json({ error: 'OS not found' });
      }

      res.json({ message: 'OS deleted successfully' });
    } catch (error) {
      console.error('Error deleting OS:', error);
      res.status(500).json({ error: 'Failed to delete OS' });
    }
  },
};

module.exports = osController;

