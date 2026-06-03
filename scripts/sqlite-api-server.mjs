#!/usr/bin/env node
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_PORT = Number.parseInt(process.env.VITAL_SQLITE_API_PORT || '8787', 10);
const dbPath = path.resolve(process.cwd(), process.env.VITAL_SQLITE_DB_PATH || 'dist/vital.db');

if (!existsSync(dbPath)) {
  console.error(`Database not found at ${dbPath}. Run a scan first.`);
  process.exit(1);
}

const db = new DatabaseSync(dbPath, { readOnly: true });

function json(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function parsePagination(urlObj) {
  const limit = Math.max(1, Math.min(10000, Number.parseInt(urlObj.searchParams.get('limit') || '1000', 10)));
  const offset = Math.max(0, Number.parseInt(urlObj.searchParams.get('offset') || '0', 10));
  return { limit, offset };
}

function isSafeIdentifier(value) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function isReadOnlySql(sql) {
  const text = String(sql || '').trim();
  if (!text) return false;
  if (/;/.test(text)) return false;
  return /^(SELECT|WITH)\b/i.test(text);
}

function getTables() {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  return tables.map(row => String(row.name));
}

const server = createServer((req, res) => {
  try {
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const pathname = urlObj.pathname;

    if (pathname === '/health') {
      return json(res, 200, {
        ok: true,
        dbPath,
        now: new Date().toISOString()
      });
    }

    if (pathname === '/api/sql/overview') {
      const summary = db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM runs) AS total_runs,
          (SELECT COUNT(*) FROM pages) AS total_pages,
          (SELECT COUNT(*) FROM violations) AS total_violations,
          (SELECT COUNT(*) FROM url_history) AS total_tracked_urls,
          (SELECT MIN(generated_at) FROM runs) AS earliest_run,
          (SELECT MAX(generated_at) FROM runs) AS latest_run
      `).get();
      return json(res, 200, summary);
    }

    if (pathname === '/api/sql/tables') {
      const tables = getTables().map(name => {
        const columns = db.prepare(`PRAGMA table_info(${name})`).all();
        return { table: name, columns };
      });
      return json(res, 200, { tables });
    }

    if (pathname === '/api/sql/urls') {
      const { limit, offset } = parsePagination(urlObj);
      const rows = db.prepare(`
        SELECT
          target_id,
          url,
          first_seen_at,
          last_success_at,
          last_status
        FROM url_history
        ORDER BY target_id, url
        LIMIT ? OFFSET ?
      `).all(limit, offset);
      const total = db.prepare('SELECT COUNT(*) AS count FROM url_history').get().count;
      return json(res, 200, { total, limit, offset, rows });
    }

    if (pathname === '/api/sql/pages') {
      const { limit, offset } = parsePagination(urlObj);
      const targetId = urlObj.searchParams.get('target_id');
      const runId = urlObj.searchParams.get('run_id');

      const clauses = [];
      const params = [];
      if (targetId) {
        clauses.push('target_id = ?');
        params.push(targetId);
      }
      if (runId) {
        clauses.push('run_id = ?');
        params.push(runId);
      }

      const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
      const rows = db.prepare(`
        SELECT
          id,
          run_id,
          target_id,
          domain,
          url,
          status,
          scanned_at,
          violation_count,
          lighthouse_score,
          plain_language_grade,
          technologies
        FROM pages
        ${where}
        ORDER BY scanned_at DESC
        LIMIT ? OFFSET ?
      `).all(...params, limit, offset);

      const total = db.prepare(`SELECT COUNT(*) AS count FROM pages ${where}`).get(...params).count;
      return json(res, 200, { total, limit, offset, rows });
    }

    if (pathname === '/api/sql/violations') {
      const { limit, offset } = parsePagination(urlObj);
      const targetId = urlObj.searchParams.get('target_id');
      const clauses = [];
      const params = [];
      if (targetId) {
        clauses.push('p.target_id = ?');
        params.push(targetId);
      }
      const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

      const rows = db.prepare(`
        SELECT
          v.id,
          p.run_id,
          p.target_id,
          p.url,
          p.scanned_at,
          v.rule_id,
          v.impact,
          v.message,
          v.selector,
          v.provider
        FROM violations v
        JOIN pages p ON p.id = v.page_id
        ${where}
        ORDER BY p.scanned_at DESC
        LIMIT ? OFFSET ?
      `).all(...params, limit, offset);

      const total = db.prepare(`
        SELECT COUNT(*) AS count
        FROM violations v
        JOIN pages p ON p.id = v.page_id
        ${where}
      `).get(...params).count;

      return json(res, 200, { total, limit, offset, rows });
    }

    if (pathname.startsWith('/api/sql/table/')) {
      const tableName = decodeURIComponent(pathname.replace('/api/sql/table/', ''));
      if (!isSafeIdentifier(tableName)) {
        return json(res, 400, { error: 'Invalid table name.' });
      }
      if (!getTables().includes(tableName)) {
        return json(res, 404, { error: `Table not found: ${tableName}` });
      }

      const { limit, offset } = parsePagination(urlObj);
      const rows = db.prepare(`SELECT * FROM ${tableName} LIMIT ? OFFSET ?`).all(limit, offset);
      const total = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get().count;
      return json(res, 200, { table: tableName, total, limit, offset, rows });
    }

    if (pathname === '/api/sql/query') {
      const q = urlObj.searchParams.get('q') || '';
      if (!isReadOnlySql(q)) {
        return json(res, 400, {
          error: 'Only single-statement SELECT or WITH queries are allowed.'
        });
      }
      const rows = db.prepare(q).all();
      return json(res, 200, { rowCount: rows.length, rows });
    }

    return json(res, 404, {
      error: 'Not found',
      routes: [
        '/health',
        '/api/sql/overview',
        '/api/sql/tables',
        '/api/sql/urls?limit=1000&offset=0',
        '/api/sql/pages?target_id=cms-gov&limit=1000&offset=0',
        '/api/sql/violations?target_id=cms-gov&limit=1000&offset=0',
        '/api/sql/table/url_history?limit=1000&offset=0',
        '/api/sql/query?q=SELECT%20COUNT(*)%20AS%20count%20FROM%20url_history'
      ]
    });
  } catch (error) {
    return json(res, 500, {
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

server.listen(DEFAULT_PORT, () => {
  console.log(`SQLite API listening on http://127.0.0.1:${DEFAULT_PORT}`);
  console.log(`Using database: ${dbPath}`);
});

process.on('SIGINT', () => {
  db.close();
  process.exit(0);
});
