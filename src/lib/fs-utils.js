// src/lib/fs-utils.js
// Small helper utilities for reading and writing JSON files.
// Used by self‑metering to safely append a record to an append‑only log.

import fs from 'node:fs';
import path from 'node:path';

/**
 * Ensure the directory for `filePath` exists, creating parents as needed.
 */
function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Read a JSON file and return its parsed content.
 * If the file does not exist, returns `null`.
 */
export function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.warn(`Failed to parse JSON at ${filePath}: ${e.message}`);
    return null;
  }
}

/**
 * Append `record` to a JSON array stored at `filePath`.
 * If the file does not exist, it is created with an array containing the record.
 * The file is written with 2‑space indentation for readability.
 */
export async function writeJsonFile(filePath, record) {
  ensureDir(filePath);
  let existing = [];
  if (fs.existsSync(filePath)) {
    try {
      const data = fs.readFileSync(filePath, 'utf8');
      existing = JSON.parse(data);
      if (!Array.isArray(existing)) existing = [];
    } catch (_) {
      // If parsing fails, start fresh to avoid corrupt log.
      existing = [];
    }
  }
  existing.push(record);
  fs.writeFileSync(filePath, JSON.stringify(existing, null, 2) + '\n');
}

/**
 * Write a per-domain ledger object (findings/resources/inventory/etc — the
 * `{ domain, updatedAt, ...content }` shape shared by src/lib/*-ledger.js and
 * inventory.js) only if its content actually changed since the last save.
 *
 * These ledgers are recomputed and re-saved on every aggregate run whether
 * or not anything new happened that week; stamping `updatedAt` unconditionally
 * means every run commits a "changed" file even when the real content is
 * identical, which is what actually drives git history growth (the content
 * itself, not the timestamp, is what anyone cares about). Comparing against
 * the on-disk content with `updatedAt` excluded avoids that: an unchanged
 * ledger is left untouched (old `updatedAt` and all), a changed one gets a
 * fresh timestamp and is written.
 */
export function writeLedgerIfChanged(filePath, ledger) {
  ensureDir(filePath);
  const strip = (k, v) => (k === 'updatedAt' ? undefined : v);
  const nextJson = JSON.stringify(ledger, strip, 1);
  if (fs.existsSync(filePath)) {
    const prevJson = JSON.stringify(readJsonFile(filePath), strip, 1);
    if (nextJson === prevJson) return false;
  }
  ledger.updatedAt = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(ledger, null, 1));
  return true;
}

export default { readJsonFile, writeJsonFile, writeLedgerIfChanged };
