// backend/utils/invoicePdf.js
const PDFDocument = require('pdfkit');

function formatAmount(n) {
  return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
}
function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const yyyy = dt.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function streamInvoicePdf(invoice, res) {
  const doc = new PDFDocument({ margin: 40 });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${invoice.number || 'facture'}.pdf"`);

  doc.pipe(res);

  // En-tête
  doc
    .fontSize(18)
    .text(invoice?.emitter?.title || 'Licence Securidem', { align: 'right' })
    .moveDown(0.2);
  doc
    .fontSize(12)
    .text(invoice?.emitter?.name || 'Association Bellevue Dembeni', { align: 'right' })
    .text(`IDENTIFIANT SIRET : ${invoice?.emitter?.siret || ''}`, { align: 'right' })
    .text(invoice?.emitter?.address || '', { align: 'right' })
    .moveDown(1);

  // Bloc client & entête facture
  doc
    .fontSize(20)
    .text('Facture', { align: 'left' })
    .moveDown(0.5);
  doc
    .fontSize(12)
    .text(`Facture N° : ${invoice.number || ''}`)
    .text(`Date de la Facture : ${fmtDate(invoice.issueDate)}`)
    .moveDown(0.5);

  doc
    .fontSize(12)
    .text('Client :')
    .text(`- Nom : ${invoice?.customer?.name || ''}`)
    .text(`- Email : ${invoice?.customer?.email || ''}`)
    .text(`- Commune : ${invoice?.customer?.communeName || invoice?.customer?.communeId || ''}`)
    .moveDown(0.8);

  // Détails abonnement
  if (invoice.planName || invoice.periodStart || invoice.periodEnd) {
    doc.fontSize(12).text('Détails abonnement :');
    if (invoice.planName) doc.text(`- Offre/Plan : ${invoice.planName}`);
    if (invoice.periodStart || invoice.periodEnd) {
      doc.text(`- Période : ${fmtDate(invoice.periodStart)} au ${fmtDate(invoice.periodEnd)}`);
    }
    doc.moveDown(0.6);
  }

  // Tableau items
  const tableTop = doc.y + 5;
  const left = 40;
  const colDesc = left;
  const colQty = 320;
  const colUnit = 380;
  const colAmt = 460;

  doc.fontSize(12).text('Description', colDesc, tableTop);
  doc.text('Qté', colQty, tableTop);
  doc.text('PU', colUnit, tableTop);
  doc.text('Montant', colAmt, tableTop);
  doc.moveTo(left, tableTop + 15).lineTo(560, tableTop + 15).stroke();

  let y = tableTop + 25;
  (invoice.items || []).forEach((it) => {
    doc.text(it.description || '', colDesc, y, { width: colQty - colDesc - 10 });
    doc.text(String(it.quantity ?? 1), colQty, y);
    doc.text(`${formatAmount(it.unitPrice)} ${invoice.currency}`, colUnit, y);
    doc.text(`${formatAmount(it.amount)} ${invoice.currency}`, colAmt, y);
    y += 18;
  });

  // Totaux
  y += 10;
  doc.moveTo(340, y).lineTo(560, y).stroke();
  y += 6;

  const tSubtotal = `${formatAmount(invoice.subtotal)} ${invoice.currency}`;
  const tTax = `${formatAmount(invoice.taxAmount)} ${invoice.currency} (${formatAmount(invoice.taxRate)}%)`;
  const tTotal = `${formatAmount(invoice.total)} ${invoice.currency}`;

  doc.fontSize(12);
  doc.text('Sous-total :', 360, y); doc.text(tSubtotal, colAmt, y, { align: 'left' }); y += 16;
  doc.text('Taxes :', 360, y);      doc.text(tTax, colAmt, y, { align: 'left' });      y += 16;
  doc.fontSize(14).text('Total :', 360, y); doc.fontSize(14).text(tTotal, colAmt, y, { align: 'left' }); y += 24;

  // Notes
  if (invoice.notes) {
    doc.moveDown(0.5);
    doc.fontSize(11).text(`Notes : ${invoice.notes}`, { width: 520 });
  }

  // Footer
  doc.moveDown(1.5);
  doc.fontSize(10).fillColor('gray').text('Merci pour votre confiance.', { align: 'center' });

  doc.end();
}

module.exports = { streamInvoicePdf, formatAmount };
