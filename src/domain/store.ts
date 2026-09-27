import * as v from 'valibot';
import { parse, parseJSON, type Schema } from '../contracts/parse.js';
import { EncryptedRecord, RateWindow } from '../contracts/storage.js';
import { decrypt, encrypt } from './crypto.js';
import { AppError } from './errors.js';
import type { DurableState, SqlStorage } from './platform.js';
const Row = v.strictObject({ value: v.string(), expires: v.pipe(v.number(), v.safeInteger(), v.minValue(0)) });
export class Store {
  #expiryRevision = 1;
  #scheduledRevision = 0;
  #locks = new Map<string, Promise<unknown>>();
  constructor(readonly sql: SqlStorage, readonly now: () => number = Date.now) {
    sql.exec('CREATE TABLE IF NOT EXISTS records_v2 (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER NOT NULL)');
    sql.exec('CREATE INDEX IF NOT EXISTS records_expiring ON records_v2(expires) WHERE expires > 0');
    sql.exec('DROP INDEX IF EXISTS records_v2_expiry');
  }
  get<S extends Schema>(key: string, schema: S): v.InferOutput<S> | null {
    const raw = [...this.sql.exec('SELECT value, expires FROM records_v2 WHERE key = ?', key)][0];
    if (!raw) return null;
    const row = parse(Row, raw, 'storage');
    if (row.expires > 0 && row.expires <= this.now()) { this.delete(key); return null; }
    return parse(schema, parseJSON(row.value, 'storage'), 'storage');
  }
  put<S extends Schema>(key: string, schema: S, value: v.InferInput<S>, expires = 0): void {
    const validated = parse(schema, value, 'storage');
    if (expires > 0) this.#expiryRevision++;
    this.sql.exec('INSERT INTO records_v2(key,value,expires) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,expires=excluded.expires WHERE records_v2.value != excluded.value OR records_v2.expires != excluded.expires', key, JSON.stringify(validated), expires);
  }
  async secret<S extends Schema>(key: string, schema: S, secret: string, context: string): Promise<v.InferOutput<S> | null> {
    const record = this.get(key, EncryptedRecord);
    return record ? decrypt(schema, record.ciphertext, secret, context + ':' + key) : null;
  }
  async putSecret<S extends Schema>(key: string, schema: S, value: v.InferInput<S>, secret: string, context: string, expires: number): Promise<void> {
    const normalized = parse(schema, value, 'storage');
    this.put(key, EncryptedRecord, { version: 2, ciphertext: await encrypt(normalized, secret, context + ':' + key) }, expires);
  }
  delete(key: string): void { this.#expiryRevision++; this.sql.exec('DELETE FROM records_v2 WHERE key = ?', key); }
  limit(key: string, maximum: number, milliseconds: number): void {
    const rowKey = 'rate:' + key;
    const value = this.get(rowKey, RateWindow) || { count: 0, resets: this.now() + milliseconds };
    if (value.count >= maximum) throw new AppError(429, 'RATE_LIMIT', 'Too many requests. Try again later.', Math.max(1, Math.ceil((value.resets - this.now()) / 1000)));
    this.put(rowKey, RateWindow, { count: value.count + 1, resets: value.resets }, value.resets);
  }
  async lock<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = this.#locks.get(key) || Promise.resolve();
    const current = previous.catch(() => undefined).then(action);
    this.#locks.set(key, current);
    try { return await current; }
    finally { if (this.#locks.get(key) === current) this.#locks.delete(key); }
  }
  prune(): void { this.#expiryRevision++; this.sql.exec('DELETE FROM records_v2 WHERE expires > 0 AND expires <= ?', this.now()); }
  async schedule(state: DurableState): Promise<void> {
    if (this.#scheduledRevision === this.#expiryRevision) return;
    await this.lock('alarm', async () => {
      if (this.#scheduledRevision === this.#expiryRevision) return;
      const revision = this.#expiryRevision;
      const schema = v.strictObject({ expiry: v.nullable(v.number()) });
      const row = parse(schema, [...this.sql.exec('SELECT MIN(expires) AS expiry FROM records_v2 WHERE expires > 0')][0], 'storage');
      if (row.expiry === null) { await state.storage.deleteAlarm(); this.#scheduledRevision = revision; return; }
      const existing = await state.storage.getAlarm();
      const next = Math.max(this.now() + 1000, row.expiry);
      if (!existing || existing > next) await state.storage.setAlarm(next);
      this.#scheduledRevision = revision;
    });
  }
}
