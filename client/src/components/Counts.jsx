import { useState } from 'react';
import { Section, Ledger, Tabs } from './primitives.jsx';
import Odometer from './Odometer.jsx';
import { count, percent } from '../lib/format.js';

// Whole-number counts roll on the odometer; money/percent stay plain text.
const cell = (v, r) => (r.note || v === null || v === undefined ? '—' : <Odometer value={v} />);

const statusNote = (row) => {
  if (row.status === 'ok') return null;
  if (row.status === 'unavailable') return row.note ?? 'Not enabled';
  return row.note ?? 'Query failed';
};

function withGroups(rows) {
  return rows.map((r) => ({
    ...r,
    __muted: r.status !== 'ok',
    note: statusNote(r),
  }));
}

function ListsTable({ lists }) {
  const rows = withGroups(lists);
  const totals = rows.reduce(
    (acc, r) => ({
      active: acc.active + (r.active ?? 0),
      inactive: acc.inactive + (r.inactive ?? 0),
      total: acc.total + (r.total ?? 0),
    }),
    { active: 0, inactive: 0, total: 0 }
  );

  return (
    <Ledger
      rowKey={(r) => r.key}
      rows={[
        ...rows,
        { key: '__t', label: 'All list records', group: '', entity: '', ...totals, __total: true },
      ]}
      columns={[
        { key: 'group', header: 'Group', className: 'group-tag' },
        { key: 'label', header: 'Record type' },
        { key: 'entity', header: 'QBO entity', className: 'entity-tag' },
        { key: 'active', header: 'Active', align: 'right', render: cell },
        { key: 'inactive', header: 'Inactive', align: 'right', render: cell },
        { key: 'total', header: 'Total', align: 'right', render: cell },
        { key: 'note', header: 'Note', render: (v) => v ?? '' },
      ]}
    />
  );
}

function ChartBreakoutsTable({ chartBreakouts }) {
  if (!chartBreakouts?.length) return null;
  const rows = withGroups(chartBreakouts);

  return (
    <div style={{ marginTop: 18 }}>
      <h3 className="card__title">AR / AP accounts in the chart of accounts</h3>
      <Ledger
        rowKey={(r) => r.key}
        rows={rows}
        columns={[
          { key: 'label', header: 'Account type' },
          { key: 'active', header: 'Active', align: 'right', render: cell },
          { key: 'inactive', header: 'Inactive', align: 'right', render: cell },
          { key: 'total', header: 'Total', align: 'right', render: cell },
          { key: 'note', header: 'Note', render: (v) => v ?? '' },
        ]}
      />
    </div>
  );
}

function TransactionsTable({ transactionBuckets, rangeLabel }) {
  const rows = withGroups(transactionBuckets ?? []);
  const total = rows.reduce((acc, r) => acc + (r.total ?? 0), 0);

  return (
    <Ledger
      rowKey={(r) => r.key}
      rows={[
        ...rows,
        { key: '__t', label: 'All transactions', total, __total: true },
      ]}
      columns={[
        { key: 'label', header: 'Transaction type' },
        {
          key: 'total',
          header: rangeLabel ?? 'Total',
          align: 'right',
          render: cell,
        },
        {
          key: 'share',
          header: 'Share',
          align: 'right',
          render: (_, r) =>
            r.note || !total ? '—' : percent((r.total / total) * 100, { signed: false }),
        },
        {
          key: 'members',
          header: 'Includes',
          render: (v) => (Array.isArray(v) ? v.join(', ') : ''),
        },
        { key: 'note', header: 'Note', render: (v) => v ?? '' },
      ]}
    />
  );
}

export function CountsSection({ counts, rangeLabel }) {
  const [tab, setTab] = useState('transactions');

  return (
    <Section
      title="What's in the file"
      note={
        rangeLabel
          ? `Lists scoped to "created ${rangeLabel.toLowerCase()}" · ${counts.queriesIssued} count queries, batched`
          : `${counts.queriesIssued} count queries, batched`
      }
    >
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'transactions', label: `Transactions (${count(counts.totals.transactionRecords)})` },
          { id: 'lists', label: `Lists (${count(counts.totals.listRecords)})` },
        ]}
      />
      {tab === 'lists' ? (
        <>
          <ListsTable lists={counts.lists} />
          <ChartBreakoutsTable chartBreakouts={counts.chartBreakouts} />
        </>
      ) : (
        <TransactionsTable transactionBuckets={counts.transactionBuckets} rangeLabel={rangeLabel} />
      )}
    </Section>
  );
}

export function AttachmentsSection({ attachments, rangeLabel }) {
  if (!attachments) return null;
  const mb = attachments.totalBytes ? (attachments.totalBytes / 1048576).toFixed(1) : null;

  return (
    <Section
      title="Attachments"
      note={
        [
          rangeLabel ? `uploaded ${rangeLabel.toLowerCase()}` : null,
          `${count(attachments.total)} total`,
          mb ? `${mb} MB` : null,
          attachments.notes ? `${count(attachments.notes)} are notes, not files` : null,
          attachments.truncated ? 'list truncated' : null,
        ]
          .filter(Boolean)
          .join(' · ')
      }
    >
      <Ledger
        rowKey={(r) => r.type}
        rows={attachments.perEntity}
        columns={[
          { key: 'type', header: 'Record type' },
          { key: 'files', header: 'Records with attachments', align: 'right', render: (v) => <Odometer value={v ?? 0} /> },
          { key: 'links', header: 'Attachment links', align: 'right', render: (v) => <Odometer value={v ?? 0} /> },
        ]}
        emptyMessage="No attachments are linked to records in this file."
      />
    </Section>
  );
}
