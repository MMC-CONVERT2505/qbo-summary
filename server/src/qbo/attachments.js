import { qbo } from './client.js';
import { ATTACHABLE_TYPES } from './catalog.js';

/**
 * QBO exposes attachments through the Attachable entity. Each one carries an
 * AttachableRef array pointing at the transactions or records it is linked to,
 * so a single file can be attached in several places.
 *
 * Filtering Attachable by AttachableRef.EntityRef.Type is unreliable across
 * company files, so we page the whole list once and group locally. On files
 * with tens of thousands of attachments, swap this for a nightly job.
 *
 * `range` scopes by the attachment's own upload date (MetaData.CreateTime) —
 * when the file was added to QBO, not the date of whatever it's linked to.
 * A receipt uploaded today against a January invoice counts in today's range.
 */
export async function fetchAttachments(realmId, { range, maxRecords = 20000 } = {}) {
  const clauses = [];
  if (range?.start) clauses.push(`MetaData.CreateTime >= '${range.start}'`);
  if (range?.end) clauses.push(`MetaData.CreateTime <= '${range.end}'`);
  const where = clauses.length ? ` where ${clauses.join(' and ')}` : '';

  const rows = [];
  let start = 1;
  const pageSize = 1000;

  for (;;) {
    const qr = await qbo.query(
      realmId,
      `select * from Attachable${where} startposition ${start} maxresults ${pageSize}`
    );
    const page = qr.Attachable ?? [];
    rows.push(...page);
    if (page.length < pageSize || rows.length >= maxRecords) break;
    start += pageSize;
  }

  const byType = new Map(ATTACHABLE_TYPES.map((t) => [t, { type: t, files: 0, links: 0 }]));
  let unlinked = 0;
  let notes = 0;
  let totalBytes = 0;

  for (const att of rows) {
    if (att.Size) totalBytes += Number(att.Size);
    // An Attachable with no FileName is a note, not a document.
    if (!att.FileName) notes += 1;

    const refs = att.AttachableRef ?? [];
    if (refs.length === 0) {
      unlinked += 1;
      continue;
    }

    const seen = new Set();
    for (const ref of refs) {
      const type = ref.EntityRef?.type;
      if (!type) continue;
      if (!byType.has(type)) byType.set(type, { type, files: 0, links: 0 });
      const bucket = byType.get(type);
      bucket.links += 1;
      if (!seen.has(type)) {
        bucket.files += 1;
        seen.add(type);
      }
    }
  }

  const perEntity = [...byType.values()]
    .filter((b) => b.links > 0)
    .sort((a, b) => b.files - a.files);

  const totalLinks = perEntity.reduce((sum, b) => sum + b.links, 0);

  return {
    // The headline attachment figure — every link an attachment has to a
    // record, plus ones with no link at all. Not the same as the raw
    // Attachable record count (totalAttachables): one attachment linked to
    // 3 records counts as 3 here, matching what a reviewer actually cares
    // about ("how many attachment relationships exist"), not how many
    // physical files were uploaded.
    total: totalLinks + unlinked,
    totalAttachables: rows.length,
    documents: rows.length - notes,
    notes,
    unlinked,
    totalBytes,
    truncated: rows.length >= maxRecords,
    perEntity,
  };
}
