import ExcelJS from 'exceljs';

const INK = 'FF14202B';
const BAND = 'FFE3EDE1';

const whole = '#,##0;[Red](#,##0)';

function styleHeader(row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INK } };
  row.alignment = { vertical: 'middle' };
  row.height = 20;
}

function bandRows(sheet, firstDataRow) {
  for (let i = firstDataRow; i <= sheet.rowCount; i += 1) {
    if ((i - firstDataRow) % 2 === 1) {
      sheet.getRow(i).eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } };
      });
    }
  }
}

function addSheet(workbook, name, columns, rows, { firstDataRow = 2 } = {}) {
  const sheet = workbook.addWorksheet(name, {
    views: [{ state: 'frozen', ySplit: firstDataRow - 1 }],
  });
  sheet.columns = columns;
  styleHeader(sheet.getRow(1));
  rows.forEach((r) => sheet.addRow(r));
  bandRows(sheet, firstDataRow);
  return sheet;
}

export async function buildExcel(summary) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'QBO Summary';
  wb.created = new Date();

  /* ---- Overview ---- */
  const overview = wb.addWorksheet('Overview');
  overview.columns = [{ width: 34 }, { width: 26 }];
  overview.addRow([summary.company.name]).font = { size: 18, bold: true, color: { argb: INK } };
  overview.addRow([`QuickBooks Online file summary — ${summary.environment}`]).font = {
    italic: true,
    color: { argb: 'FF6B7A85' },
  };
  overview.addRow([]);

  const facts = [
    ['Generated', new Date(summary.generatedAt).toLocaleString()],
    ['Realm ID', summary.realmId],
    ['Environment', summary.environment],
    ['Legal name', summary.company.legalName ?? 'n/a'],
    ['Country', summary.company.country ?? 'n/a'],
    ['Email', summary.company.email ?? 'n/a'],
    ['Company created', summary.company.createdAt ? new Date(summary.company.createdAt).toLocaleDateString() : 'n/a'],
    ['Fiscal year starts', summary.company.fiscalYearStartMonth],
    ['Reporting period', `${summary.periods.current.start} to ${summary.periods.current.end}`],
    ['List records', summary.counts.totals.listRecords],
    ['Inactive list records', summary.counts.totals.inactiveRecords],
    [`Transactions (${summary.periods.current.label})`, summary.counts.totals.transactionRecords],
    [`Attachments (${summary.periods.current.label})`, summary.attachments?.total ?? 'n/a'],
    ['Open receivables', summary.financials.receivables?.total ?? 'n/a'],
    ['Open payables', summary.financials.payables?.total ?? 'n/a'],
  ];
  facts.forEach(([k, v]) => {
    const row = overview.addRow([k, v]);
    row.getCell(1).font = { bold: true };
    if (typeof v === 'number') row.getCell(2).numFmt = whole;
  });

  /* ---- File profile (folded into Overview, not its own sheet) ---- */
  if (summary.fileProfile) {
    const p = summary.fileProfile;
    const yn = (v) => (v === null || v === undefined ? 'n/a' : v ? 'Yes' : 'No');
    overview.addRow([]);
    const profileHeader = overview.addRow(['File profile']);
    profileHeader.getCell(1).font = { bold: true, color: { argb: INK } };
    const profileRows = [
      ['Chart of accounts', p.chartOfAccounts ?? 'n/a'],
      ['Bank accounts', p.bankAccounts ?? 'n/a'],
      ['Credit card accounts', p.creditCardAccounts ?? 'n/a'],
      ['Multi-currency', yn(p.multiCurrency)],
      ['Active employees', p.activeEmployees ?? 'n/a'],
      ['Attachments', p.attachments ?? 'n/a'],
      ['Classes', p.classes ?? 'n/a'],
      ['Locations', p.locations ?? 'n/a'],
      ['Tracked inventory', yn(p.trackedInventory)],
      ['Projects', yn(p.projects)],
      ['Estimates / quotes', p.estimates ?? 'n/a'],
      ['Purchase orders', p.purchaseOrders ?? 'n/a'],
      ['Fixed assets', yn(p.fixedAssets)],
      ['Tax tracking (VAT / GST / sales tax)', yn(p.taxTracking)],
      ['Fiscal year end', p.fiscalYearEnd ?? 'n/a'],
    ];
    profileRows.forEach(([k, v]) => {
      const row = overview.addRow([k, v]);
      row.getCell(1).font = { bold: true };
      if (typeof v === 'number') row.getCell(2).numFmt = whole;
    });
  }

  if (summary.financials.errors?.length) {
    overview.addRow([]);
    const notesHeader = overview.addRow(['Notes']);
    notesHeader.getCell(1).font = { bold: true, color: { argb: INK } };
    for (const err of summary.financials.errors) overview.addRow([err]);
  }

  /* ---- Lists ---- */
  addSheet(
    wb,
    'Lists',
    [
      { header: 'Record type', key: 'label', width: 26 },
      { header: 'QBO entity', key: 'entity', width: 18 },
      { header: 'Active', key: 'active', width: 12, style: { numFmt: whole } },
      { header: 'Inactive', key: 'inactive', width: 12, style: { numFmt: whole } },
      { header: 'Total', key: 'total', width: 12, style: { numFmt: whole } },
      { header: 'Status', key: 'note', width: 34 },
    ],
    summary.counts.lists.map((l) => ({
      ...l,
      note: l.status === 'ok' ? '' : (l.note ?? l.status),
    }))
  );

  /* ---- AR/AP account breakdown ---- */
  if (summary.counts.chartBreakouts?.length) {
    addSheet(
      wb,
      'AR-AP accounts',
      [
        { header: 'Account type', key: 'label', width: 30 },
        { header: 'Active', key: 'active', width: 12, style: { numFmt: whole } },
        { header: 'Inactive', key: 'inactive', width: 12, style: { numFmt: whole } },
        { header: 'Total', key: 'total', width: 12, style: { numFmt: whole } },
        { header: 'Status', key: 'note', width: 34 },
      ],
      summary.counts.chartBreakouts.map((c) => ({
        ...c,
        note: c.status === 'ok' ? '' : (c.note ?? c.status),
      }))
    );
  }

  /* ---- Transactions (grouped, matches the results screen) ----
     Exact-entry count: one row per transaction, however many accounts or
     lines it touches. */
  addSheet(
    wb,
    'Transactions',
    [
      { header: 'Bucket', key: 'label', width: 20 },
      { header: summary.periods.current.label, key: 'total', width: 20, style: { numFmt: whole } },
      { header: 'Includes', key: 'members', width: 40 },
      { header: 'Status', key: 'note', width: 34 },
    ],
    summary.counts.transactionBuckets.map((t) => ({
      ...t,
      members: (t.members ?? []).join(', '),
      note: t.status === 'ok' ? '' : (t.note ?? t.status),
    }))
  );

  /* ---- Transactions (Total Lines) ----
     Run in parallel with the exact-entry sheet above, not instead of it —
     this is the raw line count from Transaction Detail by Account (a
     transaction that posts to 2 accounts counts twice here). Skipped
     entirely if that report call failed rather than showing a blank sheet. */
  if (summary.counts.transactionLineBuckets) {
    addSheet(
      wb,
      'Transactions (Total Lines)',
      [
        { header: 'Bucket', key: 'label', width: 20 },
        { header: summary.periods.current.label, key: 'total', width: 20, style: { numFmt: whole } },
        { header: 'Includes', key: 'members', width: 40 },
        { header: 'Status', key: 'note', width: 34 },
      ],
      summary.counts.transactionLineBuckets.map((t) => ({
        ...t,
        members: (t.members ?? []).join(', '),
        note: t.status === 'ok' ? '' : (t.note ?? t.status),
      }))
    );
  }

  /* ---- Attachments ---- */
  if (summary.attachments) {
    const att = summary.attachments;
    const mb = att.totalBytes ? (att.totalBytes / 1048576).toFixed(1) : null;

    const attSheet = wb.addWorksheet('Attachments');
    attSheet.columns = [{ width: 30 }, { width: 20 }];
    const statRows = [
      ['Total attachments', att.total],
      ['Attachable records', att.totalAttachables],
      ['Documents (with a file)', att.documents],
      ['Notes (no file)', att.notes],
      ['Unlinked to any record', att.unlinked],
      ['Total size (MB)', mb ? Number(mb) : 'n/a'],
      ['List truncated at cap', att.truncated ? 'Yes' : 'No'],
    ];
    statRows.forEach(([k, v]) => {
      const row = attSheet.addRow([k, v]);
      row.getCell(1).font = { bold: true };
      if (typeof v === 'number') row.getCell(2).numFmt = whole;
    });
    attSheet.addRow([]);

    const perEntityStart = attSheet.rowCount + 1;
    const hdrRow = attSheet.addRow(['Entity type', 'Records with files', 'Total links']);
    styleHeader(hdrRow);
    attSheet.getColumn(2).width = 20;
    attSheet.getColumn(3).width = 16;
    for (const e of att.perEntity ?? []) {
      const row = attSheet.addRow([e.type, e.files, e.links]);
      row.getCell(2).numFmt = whole;
      row.getCell(3).numFmt = whole;
    }
    bandRows(attSheet, perEntityStart + 1);
  }

  return wb.xlsx.writeBuffer();
}
