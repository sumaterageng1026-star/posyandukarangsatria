'use strict';

window.PosyanduExports = (() => {
  const encoder = new TextEncoder();
  const xml = value => String(value).replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[char]));
  const pdfText = value => String(value).replace(/[–—]/g, '-').replace(/·/g, '|').normalize('NFD').replace(/[^\x20-\x7E]/g, '').replace(/[()\\]/g, char => '\\' + char);
  const textAt = (size, x, y, text) => `BT /F1 ${size} Tf ${x} ${y} Td (${pdfText(text)}) Tj ET`;

  function sessionRows(session) {
    return [
      [session.placeName + ' · ' + session.name],
      [dateLabel(session.date) + ' · ' + (session.end ? session.time.replace(':', '.') + '–' + timeLabel(session.end) : timeLabel(session.time))],
      [session.address],
      ['Penanggung jawab', session.officer],
      ['Peserta dan pemeriksaan'],
      participantColumns,
      ...(session.participants.length ? session.participants : [['Belum ada peserta tercatat.']]),
      ['Stok per sesi'],
      inventoryColumns,
      ...(session.inventory.length ? session.inventory : [['Stok sesi belum tercatat.']]),
      [],
    ];
  }

  function wrapLine(value, limit) {
    const words = String(value).trim().split(/\s+/);
    const lines = [];
    let line = '';
    for (const word of words) {
      if (line && line.length + 1 + word.length > limit) {
        lines.push(line);
        line = '';
      }
      line += (line ? ' ' : '') + word;
    }
    if (line) lines.push(line);
    return lines;
  }

  function pdf(report, period) {
    const pages = [];
    let commands;
    let y;
    function startPage(subtitle) {
      commands = [
        '0.66 0.24 0.39 rg 0 827 595 15 re f',
        textAt(22, 45, 780, 'Posyandu Karangsatria'),
        '0.24 0.15 0.19 rg',
        textAt(14, 45, 753, subtitle),
        textAt(10, 45, 734, period + ' | Perlu verifikasi pengelola | Disetujui'),
      ];
      pages.push(commands);
      y = 703;
    }
    function printRow(row, size, subtitle) {
      const columnWidth = 505 / row.length;
      const cells = row.map(cell => wrapLine(cell, Math.floor(columnWidth / (size * 0.62))));
      const height = 7 + Math.max(1, ...cells.map(lines => lines.length)) * (size + 2);
      if (y - height < 50) startPage(subtitle + ' (lanjutan)');
      cells.forEach((lines, column) => {
        lines.forEach((line, index) => commands.push(textAt(size, 45 + columnWidth * column, y - index * (size + 2), line)));
      });
      if (row.length > 1) commands.push(`0.92 0.83 0.85 RG 44 ${y - height + 5} m 548 ${y - height + 5} l S`);
      y -= height;
    }
    startPage(report.kind);
    printRow(['Ringkasan', 'Jumlah'], 11, report.kind);
    for (const row of report.rows) printRow(row, 11, report.kind);
    for (const session of report.sessions ?? []) {
      startPage(session.placeName);
      for (const row of sessionRows(session)) {
        if (row.length) printRow(row, row.length === 1 ? 11 : 9, session.placeName);
      }
    }
    const kids = pages.map((_, index) => (4 + index * 2) + ' 0 R').join(' ');
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      `<< /Type /Pages /Count ${pages.length} /Kids [${kids}] >>`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      ...pages.flatMap((page, index) => {
        const stream = page.join('\n');
        return [
          `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`,
          `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
        ];
      }),
    ];
    let result = '%PDF-1.4\n';
    const offsets = objects.map((object, index) => {
      const offset = result.length;
      result += `${index + 1} 0 obj\n${object}\nendobj\n`;
      return String(offset).padStart(10, '0') + ' 00000 n \n';
    });
    const xref = result.length;
    result += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return new Blob([result], { type: 'application/pdf' });
  }

  function crc32(bytes) {
    let value = 0xffffffff;
    for (const byte of bytes) {
      value ^= byte;
      for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (-(value & 1) & 0xedb88320);
    }
    return (value ^ 0xffffffff) >>> 0;
  }

  function zip(files) {
    const parts = [];
    const index = [];
    let offset = 0;
    let indexSize = 0;
    for (const [path, value] of Object.entries(files)) {
      const name = encoder.encode(path);
      const body = encoder.encode(value);
      const crc = crc32(body);
      const local = new Uint8Array(30);
      const l = new DataView(local.buffer);
      l.setUint32(0, 0x04034b50, true);
      l.setUint16(4, 20, true);
      l.setUint16(12, 0x21, true);
      l.setUint32(14, crc, true);
      l.setUint32(18, body.length, true);
      l.setUint32(22, body.length, true);
      l.setUint16(26, name.length, true);
      parts.push(local, name, body);

      const central = new Uint8Array(46);
      const c = new DataView(central.buffer);
      c.setUint32(0, 0x02014b50, true);
      c.setUint16(4, 20, true);
      c.setUint16(6, 20, true);
      c.setUint16(14, 0x21, true);
      c.setUint32(16, crc, true);
      c.setUint32(20, body.length, true);
      c.setUint32(24, body.length, true);
      c.setUint16(28, name.length, true);
      c.setUint32(42, offset, true);
      index.push(central, name);
      indexSize += central.length + name.length;
      offset += local.length + name.length + body.length;
    }
    const end = new Uint8Array(22);
    const e = new DataView(end.buffer);
    e.setUint32(0, 0x06054b50, true);
    e.setUint16(8, index.length / 2, true);
    e.setUint16(10, index.length / 2, true);
    e.setUint32(12, indexSize, true);
    e.setUint32(16, offset, true);
    return new Blob([...parts, ...index, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  function xlsx(report, period) {
    const rows = [
      ['Posyandu Karangsatria', 'Perlu verifikasi pengelola'],
      [report.kind, period],
      ['Status', 'Disetujui'],
      ['Ringkasan', 'Jumlah'],
      ...report.rows,
      [],
      ...((report.sessions ?? []).flatMap(sessionRows)),
    ];
    const sheet = rows.map((row, index) => {
      const cells = row.map((value, column) => {
        const address = String.fromCharCode(65 + column) + (index + 1);
        return typeof value === 'number'
          ? `<c r="${address}"><v>${value}</v></c>`
          : `<c r="${address}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`;
      });
      return `<row r="${index + 1}">${cells.join('')}</row>`;
    });
    const officeRel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const packageRel = 'http://schemas.openxmlformats.org/package/2006/relationships';
    const spreadsheet = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    return zip({
      '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
      '_rels/.rels': `<Relationships xmlns="${packageRel}"><Relationship Id="rId1" Type="${officeRel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      'xl/workbook.xml': `<workbook xmlns="${spreadsheet}" xmlns:r="${officeRel}"><sheets><sheet name="Rekap Posyandu" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${packageRel}"><Relationship Id="rId1" Type="${officeRel}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
      'xl/worksheets/sheet1.xml': `<worksheet xmlns="${spreadsheet}"><cols><col min="1" max="1" width="48" customWidth="1"/><col min="2" max="6" width="22" customWidth="1"/></cols><sheetData>${sheet.join('')}</sheetData></worksheet>`,
    });
  }

  function download(kind, report, period) {
    const blob = kind === 'pdf' ? pdf(report, period) : xlsx(report, period);
    const anchor = document.createElement('a');
    const url = URL.createObjectURL(blob);
    anchor.href = url;
    anchor.download = `Rekap-Posyandu-${report.period}.${kind}`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2500);
  }
  return { download };
})();
