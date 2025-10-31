const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

class PDFService {
  constructor() {
    this.uploadsDir = path.join(__dirname, '../../uploads');
    this.assetsDir = path.join(__dirname, '../../assets');
    this.logoPath = path.join(this.assetsDir, 'logo.png');
    this.ensureDirectories();
  }

  ensureDirectories() {
    if (!fs.existsSync(this.uploadsDir)) {
      fs.mkdirSync(this.uploadsDir, { recursive: true });
    }
    if (!fs.existsSync(this.assetsDir)) {
      fs.mkdirSync(this.assetsDir, { recursive: true });
    }
  }

  formatarData(data) {
    if (!data) return '';
    
    // Se já está no formato DD/MM/YYYY, retorna como está
    if (typeof data === 'string' && data.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
      return data;
    }
    
    try {
      const dataObj = new Date(data);
      
      if (isNaN(dataObj.getTime())) {
        return data;
      }
      
      const dia = String(dataObj.getDate()).padStart(2, '0');
      const mes = String(dataObj.getMonth() + 1).padStart(2, '0');
      const ano = dataObj.getFullYear();
      
      return `${dia}/${mes}/${ano}`;
    } catch (error) {
      console.error('Erro ao formatar data:', error);
      return data;
    }
  }

  formatarMoeda(valor) {
    return parseFloat(valor).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    });
  }

  adicionarCabecalho(doc) {
    // Tentar adicionar logo, mas não quebrar se não existir
    try {
      if (fs.existsSync(this.logoPath)) {
        doc.image(this.logoPath, 50, 40, { width: 100 });
        console.log('✅ Logo carregada');
      } else {
        console.warn('⚠️ Logo não encontrada, continuando sem logo');
      }
    } catch (error) {
      console.warn('⚠️ Erro ao carregar logo, continuando sem logo:', error.message);
    }

    // Cabeçalho da empresa
    doc
      .fontSize(16)
      .font('Helvetica-Bold')
      .fillColor('#000000')
      .text('Artestofados', 170, 45)
      .fontSize(10)
      .font('Helvetica')
      .text('AV: Almirante Barroso, 389, Centro – João Pessoa –PB', 170, 65)
      .text('CNPJ: 08.621.718/0001-07', 170, 80);

    // Título da OS
    doc
      .fontSize(18)
      .font('Helvetica-Bold')
      .text('ORDEM DE SERVIÇO', 50, 140, { align: 'center', width: 495 });

    doc.moveDown(3);
  }

  adicionarTabelaItens(doc, dados) {
    const margemEsq = 50;
    const larguraTotal = 495;
    const colunas = [
      { header: 'QTD', width: 60 },
      { header: 'DESCRIÇÃO', width: 175 },
      { header: 'VALOR UNIT.', width: 85 },
      { header: 'DESC. (%)', width: 75 },
      { header: 'VALOR TOTAL', width: 100 },
    ];

    let currentY = doc.y;
    const headerHeight = 25;

    // ========== CABEÇALHO DA TABELA ==========
    doc.rect(margemEsq, currentY, larguraTotal, headerHeight).stroke();

    doc.fontSize(9).font('Helvetica-Bold').fillColor('#000000');
    let posX = margemEsq;
    
    colunas.forEach((col, index) => {
      // Desenhar linha vertical entre colunas
      if (index > 0) {
        doc.moveTo(posX, currentY).lineTo(posX, currentY + headerHeight).stroke();
      }
      
      doc.text(col.header, posX + 3, currentY + 8, {
        width: col.width - 6,
        align: 'center'
      });
      posX += col.width;
    });

    currentY += headerHeight;
    doc.font('Helvetica').fontSize(9);

    // ========== LINHAS DOS ITENS ==========
    dados.items.forEach(item => {
      const valorBruto = parseFloat(item.quantity) * parseFloat(item.unitValue);
      let valorFinal = valorBruto;
      const descontoItem = item.discount && parseFloat(item.discount) > 0 ? parseFloat(item.discount) : 0;
      
      // Aplicar desconto do item se houver
      if (descontoItem > 0) {
        const valorDesconto = (valorBruto * descontoItem) / 100;
        valorFinal = valorBruto - valorDesconto;
      }

      const alturaLinha = 25;

      // Nova página se necessário
      if (currentY + alturaLinha > 700) {
        doc.addPage();
        currentY = 50;
      }

      // Linha horizontal
      doc.rect(margemEsq, currentY, larguraTotal, alturaLinha).stroke();

      // Conteúdo da linha
      posX = margemEsq;
      
      colunas.forEach((col, index) => {
        // Desenhar linha vertical entre colunas
        if (index > 0) {
          doc.moveTo(posX, currentY).lineTo(posX, currentY + alturaLinha).stroke();
        }
        
        let texto = '';
        switch(index) {
          case 0: // Quantidade
            texto = item.quantity.toString();
            break;
          case 1: // Descrição
            texto = item.description;
            break;
          case 2: // Valor Unitário
            texto = this.formatarMoeda(item.unitValue);
            break;
          case 3: // Desconto
            texto = descontoItem > 0 ? `${descontoItem}%` : '-';
            break;
          case 4: // Valor Total
            texto = this.formatarMoeda(valorFinal);
            break;
        }
        
        doc.text(texto, posX + 3, currentY + 8, { 
          width: col.width - 6, 
          align: 'center' 
        });
        
        posX += col.width;
      });

      currentY += alturaLinha;
    });

    // ========== LINHAS FINAIS - SUBTOTAL, DESCONTO E TOTAL ==========
    const alturaLinha = 25;
    
    // Calcular valores SEM desconto (subtotal bruto)
    let subtotalBruto = 0;
    let descontoTotalItens = 0;
    
    dados.items.forEach(item => {
      const valorBrutoItem = parseFloat(item.quantity) * parseFloat(item.unitValue);
      subtotalBruto += valorBrutoItem;
      
      // Calcular desconto do item
      if (item.discount && parseFloat(item.discount) > 0) {
        const descontoItem = (valorBrutoItem * parseFloat(item.discount)) / 100;
        descontoTotalItens += descontoItem;
      }
    });

    // Subtotal após descontos dos itens
    const subtotalAposDescontoItens = subtotalBruto - descontoTotalItens;
    
    // Desconto geral aplicado sobre o subtotal já com desconto dos itens
    const descontoGeral = dados.discount && parseFloat(dados.discount) > 0 
      ? (subtotalAposDescontoItens * parseFloat(dados.discount)) / 100 
      : 0;
    
    const valorTotal = subtotalAposDescontoItens - descontoGeral;
    
    // Verificar se tem algum desconto (item ou geral)
    const temDescontoItem = descontoTotalItens > 0;
    const temDescontoGeral = descontoGeral > 0;
    const temDesconto = temDescontoItem || temDescontoGeral;

    const larguraTexto = colunas[0].width + colunas[1].width + colunas[2].width + colunas[3].width;
    const posXValor = margemEsq + larguraTexto;

    // Se tiver desconto de ITEM, mostrar SUBTOTAL (valor bruto)
    if (temDescontoItem) {
      doc.rect(margemEsq, currentY, larguraTotal, alturaLinha).stroke();
      
      // Linha vertical antes do valor
      doc.moveTo(posXValor, currentY).lineTo(posXValor, currentY + alturaLinha).stroke();
      
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#000000');
      
      doc.text('SUBTOTAL', margemEsq + 5, currentY + 8, {
        width: larguraTexto - 10,
        align: 'center'
      });
      
      doc.text(this.formatarMoeda(subtotalBruto), posXValor + 3, currentY + 8, {
        width: colunas[4].width - 6,
        align: 'center'
      });
      
      currentY += alturaLinha;
      
      // Mostrar linha de DESCONTO DOS ITENS
      doc.rect(margemEsq, currentY, larguraTotal, alturaLinha).stroke();
      
      // Linha vertical antes do valor
      doc.moveTo(posXValor, currentY).lineTo(posXValor, currentY + alturaLinha).stroke();
      
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#000000');
      
      doc.text('DESCONTO', margemEsq + 5, currentY + 8, {
        width: larguraTexto - 10,
        align: 'center'
      });
      
      doc.text(`- ${this.formatarMoeda(descontoTotalItens)}`, posXValor + 3, currentY + 8, {
        width: colunas[4].width - 6,
        align: 'center'
      });
      
      currentY += alturaLinha;
    }

    // Se tiver desconto GERAL (além do desconto de item), mostrar linha adicional
    if (temDescontoGeral) {
      doc.rect(margemEsq, currentY, larguraTotal, alturaLinha).stroke();
      
      // Linha vertical antes do valor
      doc.moveTo(posXValor, currentY).lineTo(posXValor, currentY + alturaLinha).stroke();
      
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#000000');
      
      doc.text(temDescontoItem ? 'DESCONTO ADICIONAL' : 'DESCONTO', margemEsq + 5, currentY + 8, {
        width: larguraTexto - 10,
        align: 'center'
      });
      
      doc.text(`- ${this.formatarMoeda(descontoGeral)}`, posXValor + 3, currentY + 8, {
        width: colunas[4].width - 6,
        align: 'center'
      });
      
      currentY += alturaLinha;
    }

    // VALOR TOTAL (sempre aparece)
    doc.rect(margemEsq, currentY, larguraTotal, alturaLinha).stroke();
    
    // Linha vertical antes do valor
    doc.moveTo(posXValor, currentY).lineTo(posXValor, currentY + alturaLinha).stroke();
    
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#000000');
    
    doc.text('VALOR TOTAL', margemEsq + 5, currentY + 8, {
      width: larguraTexto - 10,
      align: 'center'
    });

    doc.text(this.formatarMoeda(valorTotal), posXValor + 3, currentY + 8, {
      width: colunas[4].width - 6,
      align: 'center'
    });

    doc.y = currentY + alturaLinha + 20;
  }

  adicionarDadosCliente(doc, dados) {
    doc
      .fontSize(11)
      .font('Helvetica-Bold')
      .fillColor('#000000')
      .text(`Cliente: ${dados.clientName}`, 50)
      .moveDown(0.5)
      .text(`Prazo de entrega: ${this.formatarData(dados.deadline)}`)
      .moveDown(0.5)
      .text(`Forma de Pagamento: ${dados.payment}`)
      .moveDown(2);
  }

  adicionarAssinaturas(doc) {
    // Se o conteúdo atual estiver muito embaixo, cria nova página
  if (doc.y > 600) {
    doc.addPage();
  }

  // Posição padrão de assinatura no rodapé
  const posYAssinatura = 720;
  const dataAtual = new Date().toLocaleDateString('pt-BR');

  // Data no canto direito, acima das linhas
  doc
    .fontSize(11)
    .font('Helvetica')
    .text(`João Pessoa, ${dataAtual}`, 350, posYAssinatura - 50, { align: 'left' });

  // Linhas de assinatura
  const linhaInicio1 = 100;
  const linhaFim1 = 250;
  const linhaInicio2 = 350;
  const linhaFim2 = 500;

  doc.moveTo(linhaInicio1, posYAssinatura).lineTo(linhaFim1, posYAssinatura).stroke();
  doc.moveTo(linhaInicio2, posYAssinatura).lineTo(linhaFim2, posYAssinatura).stroke();

  // Nomes centralizados logo abaixo
  doc
    .fontSize(11)
    .font('Helvetica')
    .text('Artestofados', linhaInicio1, posYAssinatura + 8, {
      width: linhaFim1 - linhaInicio1,
      align: 'center'
    })
    .text('Cliente', linhaInicio2, posYAssinatura + 8, {
      width: linhaFim2 - linhaInicio2,
      align: 'center'
    });

  }

  adicionarImagensUsuario(doc, imagens) {
    if (!imagens || imagens.length === 0) return;

    doc.addPage();
    doc
      .fontSize(14)
      .font('Helvetica-Bold')
      .text('Anexos do Cliente', { align: 'center' });
    doc.moveDown(2);

    let posY = 100;
    for (const imageName of imagens) {
      try {
        const imagePath = path.join(this.uploadsDir, imageName);
        
        if (!fs.existsSync(imagePath)) {
          console.warn(`⚠️ Imagem não encontrada: ${imageName}`);
          continue;
        }

        if (posY > 650) {
          doc.addPage();
          posY = 100;
        }

        doc.image(imagePath, 100, posY, { 
          fit: [400, 400], 
          align: 'center', 
          valign: 'center' 
        });
        posY += 420;
      } catch (err) {
        console.error('❌ Erro ao adicionar imagem:', err);
      }
    }
  }

  async generateOSPDF(osData) {
    return new Promise((resolve, reject) => {
      try {
        console.log('📄 Iniciando geração de PDF...');
        
        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        const filename = `os_${osData.id || 'new'}_${Date.now()}.pdf`;
        const filepath = path.join(this.uploadsDir, filename);

        const stream = fs.createWriteStream(filepath);

        stream.on('error', (error) => {
          console.error('❌ Erro na stream:', error);
          reject(error);
        });

        doc.on('error', (error) => {
          console.error('❌ Erro no documento:', error);
          reject(error);
        });

        doc.pipe(stream);

        // Gerar PDF com estrutura IDÊNTICA ao original
        this.adicionarCabecalho(doc);
        this.adicionarTabelaItens(doc, osData);
        this.adicionarDadosCliente(doc, osData);
        this.adicionarAssinaturas(doc);

        // Adicionar imagens se houver
        if (osData.images && osData.images.length > 0) {
          const imagesArray = typeof osData.images === 'string' 
            ? JSON.parse(osData.images) 
            : osData.images;
          this.adicionarImagensUsuario(doc, imagesArray);
        }

        doc.end();

        stream.on('finish', async () => {
          try {
            const stats = fs.statSync(filepath);
            console.log('✅ PDF criado com sucesso. Tamanho:', stats.size, 'bytes');

            resolve({ 
              filename, 
              filepath,
              size: stats.size
            });
          } catch (error) {
            console.error('❌ Erro ao finalizar PDF:', error);
            reject(error);
          }
        });

      } catch (error) {
        console.error('❌ Erro ao criar documento:', error);
        reject(error);
      }
    });
  }
}

module.exports = {
  generateOSPDF: async (osData) => {
    const service = new PDFService();
    return service.generateOSPDF(osData);
  }
};