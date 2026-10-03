'use strict';
// Builds Excel and PDF files from a table described by the browser.
// The browser sends text that is already translated, so this module stays language-agnostic.
//
// Table spec:
// {
//   fileName, title, subtitle?, legend?, generatedAt?, pageLabel? ("Page {page} / {pages}"),
//   sheetName?, pageSize? ("A4" | "A3"), fontSize?, freezeColumns?,
//   columns: [{ header, width, align?: "left"|"center"|"right", format?: "percent", shade?: boolean, highlight?: boolean }],
//   rows: [[cell]], footer?: [cell]
// }
// A cell is a string, a number, null, or { value, text?, status? }.
// `value` goes into Excel (numbers stay numbers), `text` is what the PDF prints, `status` colours the cell.
const fs = require('node:fs');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

const STATUS_COLORS = {
  present: { fill: 'D9F2E3', text: '1E8E4E' },
  absent: { fill: 'F9DCD9', text: 'C0392B' },
  late: { fill: 'FBEBD0', text: 'B8730A' },
  excused: { fill: 'DCE8F6', text: '2F6FB3' },
};
const HEADER_FILL = 'E9EDF3';
const SHADE_FILL = 'F0F1F4';
const HIGHLIGHT_FILL = 'DDE5FA';
const BORDER = 'C9CFD9';

// --- Validation -----------------------------------------------------------

class SpecError extends Error {}

function str(value, max = 200) {
  return value == null ? '' : String(value).slice(0, max);
}

function normalizeCell(cell) {
  if (cell == null) return { value: null, text: '' };
  if (typeof cell === 'object') {
    const value = typeof cell.value === 'number' || cell.value == null ? cell.value ?? null : str(cell.value);
    const status = Object.hasOwn(STATUS_COLORS, cell.status) ? cell.status : undefined;
    return { value, text: str(cell.text ?? cell.value ?? ''), status };
  }
  return { value: typeof cell === 'number' ? cell : str(cell), text: str(cell) };
}

function normalizeSpec(spec) {
  if (!spec || typeof spec !== 'object') throw new SpecError();
  const columns = Array.isArray(spec.columns) ? spec.columns.slice(0, 80) : [];
  const rows = Array.isArray(spec.rows) ? spec.rows.slice(0, 5000) : [];
  if (!columns.length) throw new SpecError();

  const normalizeRow = (row) => columns.map((_, i) => normalizeCell(Array.isArray(row) ? row[i] : null));
  return {
    fileName: str(spec.fileName, 120).replace(/[\\/:*?"<>|]+/g, '_') || 'export',
    title: str(spec.title),
    subtitle: str(spec.subtitle),
    legend: str(spec.legend, 400),
    generatedAt: str(spec.generatedAt),
    pageLabel: str(spec.pageLabel) || '{page} / {pages}',
    sheetName: str(spec.sheetName, 31).replace(/[\\/*?:[\]]/g, ' ') || 'Sheet1',
    pageSize: spec.pageSize === 'A3' ? 'A3' : 'A4',
    fontSize: Math.min(Math.max(Number(spec.fontSize) || 9, 5), 14),
    freezeColumns: Math.min(Math.max(Number(spec.freezeColumns) || 0, 0), columns.length),
    columns: columns.map((c) => ({
      header: str(c?.header, 100),
      width: Math.min(Math.max(Number(c?.width) || 10, 2), 80),
      align: ['left', 'center', 'right'].includes(c?.align) ? c.align : 'left',
      format: c?.format === 'percent' ? 'percent' : undefined,
      shade: Boolean(c?.shade),
      highlight: Boolean(c?.highlight),
    })),
    rows: rows.map(normalizeRow),
    footer: Array.isArray(spec.footer) ? normalizeRow(spec.footer) : null,
  };
}

// --- Excel ----------------------------------------------------------------

async function buildXlsx(rawSpec) {
  const spec = normalizeSpec(rawSpec);
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(spec.sheetName, {
    pageSetup: { orientation: 'landscape', paperSize: spec.pageSize === 'A3' ? 8 : 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  const lastCol = spec.columns.length;
  const thin = { style: 'thin', color: { argb: `FF${BORDER}` } };
  const borders = { top: thin, left: thin, bottom: thin, right: thin };
  const fill = (hex) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${hex}` } });

  // Title block
  const intro = [
    [spec.title, { bold: true, size: 14 }],
    [spec.subtitle, { size: 11 }],
    [spec.legend, { size: 10, color: { argb: 'FF5D6677' } }],
    [spec.generatedAt, { size: 9, italic: true, color: { argb: 'FF5D6677' } }],
  ].filter(([text]) => text);
  for (const [text, font] of intro) {
    const row = sheet.addRow([text]);
    row.font = font;
    sheet.mergeCells(row.number, 1, row.number, lastCol);
  }
  if (intro.length) sheet.addRow([]);

  const headerRow = sheet.addRow(spec.columns.map((c) => c.header));
  headerRow.height = 30;
  headerRow.eachCell((cell, i) => {
    const col = spec.columns[i - 1];
    cell.font = { bold: true };
    cell.fill = fill(col.highlight ? HIGHLIGHT_FILL : HEADER_FILL);
    cell.border = borders;
    cell.alignment = { horizontal: col.align, vertical: 'middle', wrapText: true };
  });

  const writeRow = (cells, { bold = false } = {}) => {
    const row = sheet.addRow(cells.map((c) => c.value));
    cells.forEach((c, i) => {
      const col = spec.columns[i];
      const cell = row.getCell(i + 1);
      cell.border = borders;
      cell.alignment = { horizontal: col.align, vertical: 'middle' };
      if (col.format === 'percent' && typeof c.value === 'number') cell.numFmt = '0%';
      const color = c.status && STATUS_COLORS[c.status];
      if (color) {
        cell.fill = fill(color.fill);
        cell.font = { bold: true, color: { argb: `FF${color.text}` } };
      } else {
        if (bold) cell.font = { bold: true };
        if (bold) cell.fill = fill(HEADER_FILL);
        else if (col.shade) cell.fill = fill(SHADE_FILL);
      }
    });
  };
  spec.rows.forEach((cells) => writeRow(cells));
  if (spec.footer) writeRow(spec.footer, { bold: true });

  spec.columns.forEach((c, i) => {
    sheet.getColumn(i + 1).width = c.width;
  });
  sheet.views = [{ state: 'frozen', xSplit: spec.freezeColumns, ySplit: headerRow.number }];

  return { buffer: Buffer.from(await workbook.xlsx.writeBuffer()), fileName: `${spec.fileName}.xlsx` };
}

// --- PDF ------------------------------------------------------------------

// A font that covers Latin, accents and Chinese characters. PDF_FONT / PDF_FONT_BOLD override the search.
const FONT_CANDIDATES = [
  { regular: ['C:/Windows/Fonts/msyh.ttc', 'MicrosoftYaHei'], bold: ['C:/Windows/Fonts/msyhbd.ttc', 'MicrosoftYaHei-Bold'] },
  { regular: ['C:/Windows/Fonts/simsun.ttc', 'SimSun'] },
  { regular: ['/System/Library/Fonts/PingFang.ttc', 'PingFangSC-Regular'], bold: ['/System/Library/Fonts/PingFang.ttc', 'PingFangSC-Semibold'] },
  { regular: ['/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', 'NotoSansCJKsc-Regular'], bold: ['/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc', 'NotoSansCJKsc-Bold'] },
  { regular: ['/usr/share/fonts/truetype/wqy/wqy-microhei.ttc', 'WenQuanYiMicroHei'] },
];

function findFonts() {
  if (process.env.PDF_FONT) {
    return { regular: [process.env.PDF_FONT], bold: process.env.PDF_FONT_BOLD ? [process.env.PDF_FONT_BOLD] : undefined };
  }
  const found = FONT_CANDIDATES.find((f) => fs.existsSync(f.regular[0]));
  if (!found) console.warn('Aucune police chinoise trouvée : les caractères chinois ne s’afficheront pas dans les PDF (variable PDF_FONT).');
  return found;
}

const fonts = findFonts();

function registerFonts(doc) {
  if (!fonts) return { regular: 'Helvetica', bold: 'Helvetica-Bold' };
  doc.registerFont('body', ...fonts.regular);
  doc.registerFont('body-bold', ...(fonts.bold && fs.existsSync(fonts.bold[0]) ? fonts.bold : fonts.regular));
  return { regular: 'body', bold: 'body-bold' };
}

function buildPdf(rawSpec) {
  const spec = normalizeSpec(rawSpec);
  const margin = 28;
  const doc = new PDFDocument({ size: spec.pageSize, layout: 'landscape', margin, bufferPages: true });
  doc.info.Title = spec.title;
  const font = registerFonts(doc);

  const pageWidth = doc.page.width - margin * 2;
  const pageBottom = doc.page.height - margin - 14; // room for the page number
  const totalWidth = spec.columns.reduce((sum, c) => sum + c.width, 0);
  const widths = spec.columns.map((c) => (c.width / totalWidth) * pageWidth);
  const size = spec.fontSize;
  const pad = Math.max(2, size * 0.35);
  const rowHeight = size * 1.9;

  const rgb = (hex) => `#${hex}`;

  const drawCell = (x, y, w, h, text, { align, bold, fillHex, colorHex, wrap = false }) => {
    if (fillHex) doc.rect(x, y, w, h).fill(rgb(fillHex));
    doc.rect(x, y, w, h).lineWidth(0.4).stroke(rgb(BORDER));
    if (!text) return;
    doc.font(bold ? font.bold : font.regular).fontSize(size).fillColor(rgb(colorHex || '1D2330'));
    const textHeight = wrap ? doc.heightOfString(text, { width: w - pad * 2, align }) : size;
    doc.text(text, x + pad, y + Math.max(pad, (h - textHeight) / 2 - 1), {
      width: w - pad * 2,
      height: h - pad,
      align,
      lineBreak: wrap,
      ellipsis: !wrap,
    });
  };

  const headerHeight = (() => {
    doc.font(font.bold).fontSize(size);
    const tallest = Math.max(...spec.columns.map((c, i) => doc.heightOfString(c.header, { width: widths[i] - pad * 2 })));
    return Math.max(rowHeight, tallest + pad * 2);
  })();

  const drawHeader = (y) => {
    let x = margin;
    spec.columns.forEach((c, i) => {
      drawCell(x, y, widths[i], headerHeight, c.header, {
        align: c.align, bold: true, wrap: true, fillHex: c.highlight ? HIGHLIGHT_FILL : HEADER_FILL,
      });
      x += widths[i];
    });
    return y + headerHeight;
  };

  const drawRow = (cells, y, { bold = false } = {}) => {
    let x = margin;
    cells.forEach((c, i) => {
      const col = spec.columns[i];
      const color = c.status && STATUS_COLORS[c.status];
      drawCell(x, y, widths[i], rowHeight, c.text, {
        align: col.align,
        bold: bold || Boolean(color),
        fillHex: color ? color.fill : bold ? HEADER_FILL : col.shade ? SHADE_FILL : undefined,
        colorHex: color?.text,
      });
      x += widths[i];
    });
    return y + rowHeight;
  };

  // Title block (first page only)
  let y = margin;
  if (spec.title) {
    doc.font(font.bold).fontSize(16).fillColor('#1D2330').text(spec.title, margin, y, { width: pageWidth });
    y = doc.y + 2;
  }
  for (const [text, fontSize] of [[spec.subtitle, 11], [spec.legend, 9], [spec.generatedAt, 8]]) {
    if (!text) continue;
    doc.font(font.regular).fontSize(fontSize).fillColor(fontSize === 11 ? '#1D2330' : '#5D6677').text(text, margin, y, { width: pageWidth });
    y = doc.y + 2;
  }
  y = drawHeader(y + 8);

  const rows = spec.footer ? [...spec.rows.map((r) => [r]), [spec.footer, { bold: true }]] : spec.rows.map((r) => [r]);
  for (const [cells, options] of rows) {
    if (y + rowHeight > pageBottom) {
      doc.addPage();
      y = drawHeader(margin);
    }
    y = drawRow(cells, y, options);
  }

  // Page numbers
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.page.margins.bottom = 0; // writing inside the bottom margin must not start a new page
    const label = spec.pageLabel.replace('{page}', String(i + 1)).replace('{pages}', String(range.count));
    doc.font(font.regular).fontSize(8).fillColor('#5D6677')
      .text(label, margin, doc.page.height - margin - 8, { width: pageWidth, align: 'right', lineBreak: false });
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), fileName: `${spec.fileName}.pdf` }));
    doc.on('error', reject);
    doc.end();
  });
}

module.exports = { buildXlsx, buildPdf, SpecError };
