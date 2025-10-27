const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const osController = require('../controllers/os');

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
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
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

/**
 * @swagger
 * /os/criar:
 *   post:
 *     summary: Create a new OS
 *     tags: [OS]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - clientName
 *               - deadline
 *               - payment
 *               - items
 *             properties:
 *               clientName:
 *                 type: string
 *               deadline:
 *                 type: string
 *               payment:
 *                 type: string
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     description:
 *                       type: string
 *                     quantity:
 *                       type: number
 *                     unitValue:
 *                       type: number
 *                     total:
 *                       type: number
 *               discount:
 *                 type: number
 *               images:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: OS created successfully
 */
router.post('/criar', osController.criar);

/**
 * @swagger
 * /os:
 *   get:
 *     summary: List all OS
 *     tags: [OS]
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by client name or OS number
 *     responses:
 *       200:
 *         description: List of OS
 */
router.get('/', osController.listar);

/**
 * @swagger
 * /os/{id}:
 *   get:
 *     summary: Get OS by ID
 *     tags: [OS]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: OS details
 */
router.get('/:id', osController.obter);

/**
 * @swagger
 * /os/{id}/download:
 *   get:
 *     summary: Download OS PDF
 *     tags: [OS]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: PDF download
 */
router.get('/:id/download', osController.download);

/**
 * @swagger
 * /os/{id}:
 *   put:
 *     summary: Update OS
 *     tags: [OS]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: OS updated successfully
 */
router.put('/:id', osController.atualizar);

/**
 * @swagger
 * /os/{id}:
 *   delete:
 *     summary: Delete OS
 *     tags: [OS]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: OS deleted successfully
 */
router.delete('/:id', osController.deletar);

module.exports = router;

