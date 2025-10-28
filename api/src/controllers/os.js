const OrdemServico = require('../models/ordemServico');
const pdfService = require('../services/pdf');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure multer for image uploads
const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'os-image-' + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

const osController = {
  async criar(req, res) {
    try {
      // Handle file uploads first
      upload.array('images', 10)(req, res, async (err) => {
        if (err) {
          console.error('Multer error:', err);
          return res.status(400).json({ error: err.message });
        }

        try {
          const { clientName, deadline, payment, items, discount } = req.body;
          const uploadedImages = req.files || [];

          console.log('📥 Dados recebidos:', {
            clientName,
            deadline,
            payment,
            items: typeof items === 'string' ? 'String' : 'Array',
            discount,
            imagesCount: uploadedImages.length
          });

          // Validation
          if (!clientName || !deadline || !payment) {
            return res.status(400).json({ 
              error: 'Campos obrigatórios faltando: clientName, deadline, payment' 
            });
          }

          // Parse items if it's a string
          let itemsArray;
          try {
            itemsArray = typeof items === 'string' ? JSON.parse(items) : items;
          } catch (parseError) {
            console.error('Erro ao fazer parse dos items:', parseError);
            return res.status(400).json({ error: 'Items inválido' });
          }

          if (!itemsArray || itemsArray.length === 0) {
            return res.status(400).json({ 
              error: 'É necessário informar ao menos um item' 
            });
          }

          // Validate items structure
          for (const item of itemsArray) {
            if (!item.description || !item.quantity || !item.unitValue) {
              return res.status(400).json({ 
                error: 'Cada item deve ter: description, quantity, unitValue' 
              });
            }
            // Ensure total is calculated
            if (!item.total) {
              const qty = parseFloat(item.quantity);
              const unitVal = parseFloat(item.unitValue);
              const itemDiscount = parseFloat(item.discount || 0);
              const subtotal = qty * unitVal;
              item.total = (subtotal - (subtotal * itemDiscount / 100)).toFixed(2);
            }
          }

          console.log('✅ Itens validados:', itemsArray);

          // Prepare image filenames
          const imageFilenames = uploadedImages.map(file => file.filename);

          // Create OS in database
          const osData = await OrdemServico.create({
            clientName,
            deadline,
            payment,
            items: itemsArray,
            discount: discount || 0,
            images: imageFilenames,
          });

          console.log('💾 OS criada no banco:', osData.id);

          // Generate PDF with all data
          const pdfData = {
            id: osData.id,
            clientName: osData.client_name,
            deadline: osData.deadline,
            payment: osData.payment,
            items: typeof osData.items === 'string' ? JSON.parse(osData.items) : osData.items,
            discount: osData.discount,
            images: typeof osData.images === 'string' ? JSON.parse(osData.images) : osData.images,
            createdAt: osData.created_at,
          };

          console.log('📄 Gerando PDF com dados:', {
            id: pdfData.id,
            clientName: pdfData.clientName,
            itemsCount: pdfData.items.length,
            discount: pdfData.discount
          });

          const pdf = await pdfService.generateOSPDF(pdfData);

          console.log('✅ PDF gerado:', pdf.filename);

          // Update OS with PDF path
          await OrdemServico.update(osData.id, {
            pdfPath: pdf.filename,
          });

          res.json({
            success: true,
            message: 'OS created successfully',
            os: {
              id: osData.id,
              clientName: osData.client_name,
              deadline: osData.deadline,
              payment: osData.payment,
              discount: osData.discount,
            },
            pdf: {
              filename: pdf.filename,
              path: `/uploads/${pdf.filename}`,
            },
          });
        } catch (error) {
          console.error('❌ Error creating OS:', error);
          res.status(500).json({ error: 'Failed to create OS: ' + error.message });
        }
      });
    } catch (error) {
      console.error('❌ Error creating OS:', error);
      res.status(500).json({ error: 'Failed to create OS: ' + error.message });
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