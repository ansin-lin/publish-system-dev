import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { JsonObject } from "../step2-collect/types.js";
import { nowIsoJst } from "./time.js";
import type { OrchestratorSettings, OutboxEvent, OutboxEventStatus, OutboxEventType } from "./types.js";

function rowToEvent(row: unknown): OutboxEvent {
  const r = row as Record<string, unknown>;
  return {
    event_id: String(r.event_id),
    event_type: String(r.event_type) as OutboxEventType,
    task_id: String(r.task_id),
    run_id: String(r.run_id),
    revision: Number(r.revision),
    payload_json: String(r.payload_json),
    status: String(r.status) as OutboxEventStatus,
    retry_count: Number(r.retry_count),
    next_retry_at: String(r.next_retry_at),
    locked_at: r.locked_at === null || r.locked_at === undefined ? null : String(r.locked_at),
    locked_by: r.locked_by === null || r.locked_by === undefined ? null : String(r.locked_by),
    created_at: String(r.created_at),
    processed_at: r.processed_at === null || r.processed_at === undefined ? null : String(r.processed_at),
  };
}

export class OutboxRepo {
  private readonly db: DatabaseSync;

  constructor(readonly dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA busy_timeout = 5000;");
  }

  close(): void {
    this.db.close();
  }

  init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS outbox_events (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        task_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'done', 'failed')),
        retry_count INTEGER NOT NULL DEFAULT 0,
        next_retry_at TEXT NOT NULL,
        locked_at TEXT,
        locked_by TEXT,
        created_at TEXT NOT NULL,
        processed_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_outbox_ready
      ON outbox_events (status, next_retry_at);

      CREATE INDEX IF NOT EXISTS idx_outbox_task_revision
      ON outbox_events (task_id, run_id, revision);
    `);
  }

  insertEvent(params: {
    eventId: string;
    eventType: OutboxEventType;
    taskId: string;
    runId: string;
    revision: number;
    payload: JsonObject;
    now?: string;
  }): OutboxEvent {
    const now = params.now ?? nowIsoJst();
    this.db
      .prepare(
        `INSERT INTO outbox_events (
          event_id, event_type, task_id, run_id, revision, payload_json,
          status, retry_count, next_retry_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
      )
      .run(params.eventId, params.eventType, params.taskId, params.runId, params.revision, JSON.stringify(params.payload), now, now);
    return {
      event_id: params.eventId,
      event_type: params.eventType,
      task_id: params.taskId,
      run_id: params.runId,
      revision: params.revision,
      payload_json: JSON.stringify(params.payload),
      status: "pending",
      retry_count: 0,
      next_retry_at: now,
      locked_at: null,
      locked_by: null,
      created_at: now,
      processed_at: null,
    };
  }

  listReady(limit: number, now = nowIsoJst()): OutboxEvent[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM outbox_events
         WHERE status = 'pending' AND next_retry_at <= ?
         ORDER BY created_at ASC
         LIMIT ?`,
      )
      .all(now, limit);
    return rows.map(rowToEvent);
  }

  claim(eventId: string, dispatcherId: string, now = nowIsoJst()): boolean {
    const result = this.db
      .prepare(
        `UPDATE outbox_events
         SET status = 'processing', locked_at = ?, locked_by = ?
         WHERE event_id = ? AND status = 'pending'`,
      )
      .run(now, dispatcherId, eventId);
    return result.changes === 1;
  }

  markDone(eventId: string, now = nowIsoJst()): void {
    this.db
      .prepare(
        `UPDATE outbox_events
         SET status = 'done', processed_at = ?, locked_at = NULL, locked_by = NULL
         WHERE event_id = ?`,
      )
      .run(now, eventId);
  }

  retryOrFail(event: OutboxEvent, maxAttempts: number, backoffMs: number[], nowDate = new Date()): void {
    const nextRetryCount = event.retry_count + 1;
    if (nextRetryCount >= maxAttempts) {
      this.db
        .prepare(
          `UPDATE outbox_events
           SET status = 'failed', retry_count = ?, processed_at = ?, locked_at = NULL, locked_by = NULL
           WHERE event_id = ?`,
        )
        .run(nextRetryCount, nowIsoJst(), event.event_id);
      return;
    }
    const delay = backoffMs[Math.min(nextRetryCount - 1, backoffMs.length - 1)] ?? 1000;
    const nextRetryAt = new Date(nowDate.getTime() + delay);
    const offsetMs = 9 * 60 * 60 * 1000;
    const nextIso = `${new Date(nextRetryAt.getTime() + offsetMs).toISOString().slice(0, 19)}+09:00`;
    this.db
      .prepare(
        `UPDATE outbox_events
         SET status = 'pending', retry_count = ?, next_retry_at = ?, locked_at = NULL, locked_by = NULL
         WHERE event_id = ?`,
      )
      .run(nextRetryCount, nextIso, event.event_id);
  }

  resetStaleProcessing(olderThanIso: string): number {
    const result = this.db
      .prepare(
        `UPDATE outbox_events
         SET status = 'pending', locked_at = NULL, locked_by = NULL
         WHERE status = 'processing' AND locked_at IS NOT NULL AND locked_at < ?`,
      )
      .run(olderThanIso);
    return Number(result.changes);
  }

  hasOpenEventForTask(taskId: string, runId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT event_id FROM outbox_events
         WHERE task_id = ? AND run_id = ? AND status IN ('pending', 'processing')
         LIMIT 1`,
      )
      .get(taskId, runId);
    return row !== undefined;
  }

  /** Read-only: all outbox rows for a task, oldest first. */
  listByTaskId(taskId: string, runId?: string, limit = 500): OutboxEvent[] {
    this.init();
    const rows = runId
      ? this.db
          .prepare(
            `SELECT * FROM outbox_events
             WHERE task_id = ? AND run_id = ?
             ORDER BY created_at ASC
             LIMIT ?`,
          )
          .all(taskId, runId, limit)
      : this.db
          .prepare(
            `SELECT * FROM outbox_events
             WHERE task_id = ?
             ORDER BY created_at ASC
             LIMIT ?`,
          )
          .all(taskId, limit);
    return rows.map(rowToEvent);
  }

  /** Read-only: filter outbox rows for dashboard (newest first). */
  listByFilter(params: {
    statuses?: OutboxEventStatus[];
    taskId?: string;
    limit?: number;
  }): OutboxEvent[] {
    this.init();
    const limit = Math.min(Math.max(params.limit ?? 100, 1), 500);
    const clauses: string[] = [];
    const bind: Array<string | number> = [];

    if (params.statuses?.length) {
      clauses.push(`status IN (${params.statuses.map(() => "?").join(", ")})`);
      bind.push(...params.statuses);
    }
    if (params.taskId?.trim()) {
      clauses.push("task_id = ?");
      bind.push(params.taskId.trim());
    }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    bind.push(limit);
    const rows = this.db
      .prepare(
        `SELECT * FROM outbox_events
         ${where}
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(...bind);
    return rows.map(rowToEvent);
  }

  /** Read-only: count rows grouped by status. */
  countByStatus(): Record<OutboxEventStatus, number> {
    this.init();
    const rows = this.db
      .prepare(`SELECT status, COUNT(*) AS count FROM outbox_events GROUP BY status`)
      .all() as Array<{ status: string; count: number }>;

    const counts: Record<OutboxEventStatus, number> = {
      pending: 0,
      processing: 0,
      done: 0,
      failed: 0,
    };
    for (const row of rows) {
      if (row.status in counts) counts[row.status as OutboxEventStatus] = Number(row.count);
    }
    return counts;
  }

  /** Removes all outbox rows (e.g. after deleting task folders). Returns deleted row count. */
  deleteAllEvents(): number {
    this.init();
    const result = this.db.prepare(`DELETE FROM outbox_events`).run();
    this.db.exec("VACUUM;");
    return Number(result.changes);
  }
}

export function createOutboxRepo(settings: OrchestratorSettings): OutboxRepo {
  return new OutboxRepo(settings.dbPath);
}
