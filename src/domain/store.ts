import * as v from 'valibot';
import { parse, parseJSON, type Schema } from '../contracts/parse.js';
import { EncryptedRecord, RateWindow } from '../contracts/storage.js';
import { decrypt, encrypt } from './crypto.js';
import { AppError, requireCondition } from './errors.js';
import type { DurableState, SqlStorage } from './platform.js';
const Expiry = v.strictObject({ expiry: v.nullable(v.number()) });
const Row = v.strictObject({ value: v.string(), expires: v.pipe(v.number(), v.safeInteger(), v.minValue(0)) });
export class Store {
  #expiryRevision = 1;
  #scheduled?: { revision: number; additional: number | null; expiry: number | null };
  #locks = new Map<string, Promise<unknown>>();
  constructor(readonly sql: SqlStorage, readonly now: () => number = Date.now, readonly transactionSync?: <T>(run: () => T) => T) {
    sql.exec('CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER NOT NULL)');
    sql.exec('CREATE INDEX IF NOT EXISTS records_expiring ON records(expires) WHERE expires > 0');
  }
  get<S extends Schema>(key: string, schema: S): v.InferOutput<S> | null {
    const raw = [...this.sql.exec('SELECT value, expires FROM records WHERE key = ?', key)][0];
    if (!raw) return null;
    const row = parse(Row, raw, 'storage');
    if (row.expires > 0 && row.expires <= this.now()) { this.delete(key); return null; }
    return parse(schema, parseJSON(row.value, 'storage'), 'storage');
  }
  put<S extends Schema>(key: string, schema: S, value: v.InferInput<S>, expires = 0): void {
    const validated = parse(schema, value, 'storage');
    if (expires > 0) this.#expiryRevision++;
    this.sql.exec('INSERT INTO records(key,value,expires) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,expires=excluded.expires WHERE records.value != excluded.value OR records.expires != excluded.expires', key, JSON.stringify(validated), expires);
  }
  /** Bound a derived namespace without reading its artifact bodies into memory. */
  bound(prefix: string, maximumBytes: number, maximumRecords: number): void {
    let bytes = 0, records = 0;
    for (const row of this.sql.exec('SELECT key,length(CAST(value AS BLOB)) AS bytes FROM records WHERE key>=? AND key<? ORDER BY expires DESC,key', prefix, prefix + '\uffff')) {
      bytes += Number(row.bytes); records++;
      if (bytes > maximumBytes || records > maximumRecords) this.delete(String(row.key));
    }
  }
  async secret<S extends Schema>(key: string, schema: S, secret: string, context: string): Promise<v.InferOutput<S> | null> {
    const record = this.get(key, EncryptedRecord);
    return record ? decrypt(schema, record, secret, context + ':' + key) : null;
  }
  /** Optional ciphertext matching keeps asynchronous encryption from reviving a removed proof. */
  async putSecret<S extends Schema>(key: string, schema: S, value: v.InferInput<S>, secret: string, context: string, expires: number, expected?:v.InferOutput<typeof EncryptedRecord>): Promise<v.InferOutput<typeof EncryptedRecord>|null> {
    const record=await encrypt(parse(schema,value,'storage'),secret,context+':'+key);
    if(expected){
      const changed=[...this.sql.exec('UPDATE records SET value=?,expires=? WHERE key=? AND value=? RETURNING key',JSON.stringify(record),expires,key,JSON.stringify(expected))].length;
      if(!changed)return null;
      this.#expiryRevision++;
    }else this.put(key,EncryptedRecord,record,expires);
    return record;
  }
  async consumeSecret<S extends Schema>(source: string, key: string, schema: S, value: v.InferInput<S>, secret: string, context: string, expires: number): Promise<void> {
    const transaction = this.transactionSync;
    requireCondition(transaction, 503, 'STORAGE', 'Atomic credential storage is unavailable.');
    const record=await encrypt(parse(schema,value,'storage'),secret,context+':'+key);
    transaction(() => {
      requireCondition(this.get(source,EncryptedRecord),401,'OAUTH','The credential exchange has expired. Start sign-in again.');
      this.put(key, EncryptedRecord, record, expires);
      this.delete(source);
    });
  }
  delete(key: string): void { this.#expiryRevision++; this.sql.exec('DELETE FROM records WHERE key = ?', key); }
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
  prune(): void { this.#expiryRevision++; this.sql.exec('DELETE FROM records WHERE expires > 0 AND expires <= ?', this.now()); }
  /** Calls bring work forward; a naturally fired alarm decides whether to rearm. */
  async schedule(state: DurableState, additional: number | null): Promise<void> {
    if (this.#scheduled?.revision === this.#expiryRevision && this.#scheduled.additional === additional) return;
    await this.lock('alarm', async () => {
      if (this.#scheduled?.revision === this.#expiryRevision && this.#scheduled.additional === additional) return;
      const revision = this.#expiryRevision;
      const expiry = this.#scheduled?.revision === revision ? this.#scheduled.expiry
        : parse(Expiry, [...this.sql.exec('SELECT MIN(expires) AS expiry FROM records WHERE expires > 0')][0], 'storage').expiry;
      const next = Math.min(expiry === null ? Infinity : Math.max(this.now() + 1000, expiry), additional ?? Infinity);
      if (next !== Infinity) {
        const existing = await state.storage.getAlarm();
        if (existing === null || existing > next) await state.storage.setAlarm(next);
      }
      this.#scheduled = { revision, additional, expiry };
    });
  }
}
