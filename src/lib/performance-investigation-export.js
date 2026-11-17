import { toCsv } from './csv.js';

export function investigationsToCsv(queue) {
  const rows = (queue?.candidates ?? []).map((candidate) => [
    candidate.id,
    candidate.category,
    candidate.resource?.key ?? '',
    candidate.resource?.type ?? '',
    candidate.resource?.third_party === true ? 'true' : 'false',
    candidate.resource?.pages ?? '',
    candidate.resource?.transfer_bytes ?? '',
    candidate.status,
    candidate.hypothesis,
  ]);
  return toCsv(['id', 'category', 'resource', 'type', 'third_party', 'pages', 'transfer_bytes', 'status', 'hypothesis'], rows);
}
