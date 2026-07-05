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

export default { readJsonFile, writeJsonFile };
