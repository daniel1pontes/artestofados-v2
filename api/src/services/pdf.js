const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

function generateOSPDF(osData) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const uploadsDir = path.join(__dirname, '../../uploads');
      
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      const filename = `os_${osData.id || 'new'}_${Date.now()}.pdf`;
      const filepath = path.join(uploadsDir, filename);

      const stream = fs.createWriteStream(filepath);
      doc.pipe(stream);

      // Set up error handlers BEFORE creating content
      doc.on('error', (err) => {
        reject(err);
      });

      stream.on('error', (err) => {
        reject(err);
      });

      stream.on('finish', () => {
        resolve({ filename, filepath });
      });

      // Header
      doc.fontSize(20).text('ORDEM DE SERVIÇO', { align: 'center' });
      doc.moveDown();

      // Client info
      doc.fontSize(14);
      doc.text(`Cliente: ${osData.clientName}`);
      doc.text(`Data: ${new Date(osData.createdAt).toLocaleDateString('pt-BR')}`);
      
      // Format deadline date
      let deadlineText = osData.deadline;
      if (osData.deadline && !isNaN(Date.parse(osData.deadline))) {
        deadlineText = new Date(osData.deadline).toLocaleDateString('pt-BR');
      }
      doc.text(`Prazo: ${deadlineText}`);
      doc.text(`Forma de Pagamento: ${osData.payment}`);
      doc.moveDown();

      // Items
      doc.fontSize(16).text('ITENS:', { underline: true });
      doc.moveDown(0.5);
      
      doc.fontSize(12);
      let yPos = doc.y;
      
      // Table header
      doc.text('Descrição', 50, yPos);
      doc.text('Qtd', 300, yPos);
      doc.text('Vl Unit.', 350, yPos);
      doc.text('Total', 450, yPos);
      
      yPos += 20;
      doc.moveTo(50, yPos).lineTo(550, yPos).stroke();
      doc.y = yPos + 10;

      // Items rows
      const itemsArray = typeof osData.items === 'string' ? JSON.parse(osData.items) : osData.items;
      itemsArray.forEach(item => {
        const lineHeight = 30;
        const currentY = doc.y;

        // Wrap description if too long
        const descLines = doc.heightOfString(item.description, { width: 230 });
        
        doc.text(item.description, 50, currentY, { width: 230 });
        doc.text(item.quantity.toString(), 300, currentY);
        doc.text(`R$ ${parseFloat(item.unitValue).toFixed(2)}`, 350, currentY);
        doc.text(`R$ ${parseFloat(item.total).toFixed(2)}`, 450, currentY);

        doc.y += Math.max(descLines, lineHeight);
        
        doc.moveTo(50, doc.y - 5).lineTo(550, doc.y - 5).stroke();
      });

      doc.moveDown();

      // Subtotal and Discount
      const subtotal = itemsArray.reduce((sum, item) => sum + parseFloat(item.total), 0);
      const discount = parseFloat(osData.discount || 0);
      const total = subtotal - discount;

      doc.fontSize(14);
      doc.text(`Subtotal: R$ ${subtotal.toFixed(2)}`, { align: 'right' });
      doc.text(`Desconto: R$ ${discount.toFixed(2)}`, { align: 'right' });
      doc.moveDown();
      doc.fontSize(16);
      doc.text(`TOTAL: R$ ${total.toFixed(2)}`, { align: 'right', underline: true });

      doc.moveDown(2);

      // Images
      const imagesArray = typeof osData.images === 'string' ? JSON.parse(osData.images) : osData.images;
      if (imagesArray && imagesArray.length > 0) {
        doc.fontSize(14).text('IMAGENS:', { underline: true });
        doc.moveDown(0.5);

        imagesArray.forEach(imagePath => {
          try {
            const fullImagePath = path.join(__dirname, '../../uploads', imagePath);
            if (fs.existsSync(fullImagePath)) {
              const imgHeight = 150;
              const imgWidth = 200;

              // Add image if there's space, otherwise add a new page
              if (doc.y + imgHeight > doc.page.height - 100) {
                doc.addPage();
              }

              doc.image(fullImagePath, {
                fit: [imgWidth, imgHeight],
                align: 'center',
              });

              doc.moveDown();
            }
          } catch (error) {
            console.error(`Error adding image ${imagePath}:`, error);
          }
        });
      }

      doc.moveDown(2);

      // Signatures
      doc.fontSize(14).text('ASSINATURAS:', { underline: true });
      doc.moveDown(1);
      
      const signatureLine = doc.y;
      doc.moveTo(50, signatureLine).lineTo(250, signatureLine).stroke();
      doc.text('Cliente', 50, signatureLine + 10);

      doc.moveTo(300, signatureLine).lineTo(500, signatureLine).stroke();
      doc.text('Responsável', 300, signatureLine + 10);

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

module.exports = {
  generateOSPDF,
};
