import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { DB_PATH, ensureLayout } from './config';

const here = path.dirname(fileURLToPath(import.meta.url));

ensureLayout();

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(here, 'schema.sql'), 'utf8');
db.exec(schema);

export function now(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return crypto.randomUUID();
}
