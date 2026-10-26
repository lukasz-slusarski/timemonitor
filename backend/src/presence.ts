// Biuro: kto teraz nad czym pracuje. Sesje Claude Code i boty (zdarzenia z pluginu "biuro")
// oraz aktywne timery ClickUp. Stan trzymany w pamięci, odtwarzany z presence_events po restarcie.
import crypto from 'crypto';
import { db } from './database.js';

const IDLE_MS = 10 * 60e3;   // brak zdarzeń → "nieaktywny"
const STALE_MS = 3 * 3600e3; // brak zdarzeń → sesja uznana za zamkniętą
const GAP_CAP_MS = 5 * 60e3; // przerwa dłuższa niż 5 min nie liczy się do czasu pracy

const SOURCES = ['claude', 'bot'];
const STATUSES = ['working', 'waiting', 'idle', 'done'];
const MODELS = ['a', 'b', 'c', 'd', 'e', 'f'].flatMap((l) => [`character-male-${l}`, `character-female-${l}`]);

export type PresenceToken = {
  id: number;
  name: string;
  kind: 'human' | 'bot';
  app_user_id: number | null;
  model: string;
  recolor: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

type Session = {
  id: string; owner: string; source: string; project: string; title: string; summary: string;
  status: string; activity: string; started_at: number; last_at: number; last_human_at: number | null;
  ended_at: number | null; active_ms: number; clickup_task: { id: string } | null;
  subagents: Record<string, string>; counter: unknown;
};

type PresenceEvent = Record<string, any> & { ts: number; owner: string };

const sessions = new Map<string, Session>();

export function initPresence() {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS presence_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      kind TEXT DEFAULT 'human' CHECK(kind IN ('human', 'bot')),
      app_user_id INTEGER,
      token_hash TEXT UNIQUE NOT NULL,
      model TEXT DEFAULT 'character-male-f',
      recolor TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_used_at DATETIME,
      revoked_at DATETIME
    )
  `).run();
  db.prepare(`
    CREATE TABLE IF NOT EXISTS presence_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      payload TEXT NOT NULL
    )
  `).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_presence_events_ts ON presence_events(ts)`).run();

  // odtworzenie ostatniej doby po restarcie; starsze zdarzenia nie są potrzebne
  const since = Date.now() - 24 * 3600e3;
  db.prepare(`DELETE FROM presence_events WHERE ts < ?`).run(Date.now() - 30 * 24 * 3600e3);
  const rows = db.prepare(`SELECT payload FROM presence_events WHERE ts >= ? ORDER BY id`).all(since) as Array<{ payload: string }>;
  for (const r of rows) {
    try { apply(JSON.parse(r.payload)); } catch { /* uszkodzony wpis pomijamy */ }
  }
}

const hash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
const ownerOf = (t: { id: number; kind: string; app_user_id: number | null }) =>
  t.kind === 'human' && t.app_user_id ? `u${t.app_user_id}` : `t${t.id}`;

export function findToken(token: string): PresenceToken | undefined {
  return db.prepare(`SELECT * FROM presence_tokens WHERE token_hash = ? AND revoked_at IS NULL`).get(hash(token)) as PresenceToken | undefined;
}

export function createToken(input: { name: string; kind: 'human' | 'bot'; app_user_id?: number | null; model?: string; recolor?: string | null }) {
  const token = 'biuro_' + crypto.randomBytes(24).toString('base64url');
  const model = input.model && MODELS.includes(input.model) ? input.model : 'character-male-f';
  const info = db.prepare(`
    INSERT INTO presence_tokens (name, kind, app_user_id, token_hash, model, recolor) VALUES (?, ?, ?, ?, ?, ?)
  `).run(input.name, input.kind, input.kind === 'human' ? input.app_user_id ?? null : null, hash(token), model, input.recolor ?? null);
  return { id: Number(info.lastInsertRowid), token };
}

export function listTokens(): PresenceToken[] {
  return db.prepare(`
    SELECT id, name, kind, app_user_id, model, recolor, created_at, last_used_at, revoked_at
    FROM presence_tokens ORDER BY revoked_at IS NOT NULL, created_at DESC
  `).all() as PresenceToken[];
}

export function revokeToken(id: number) {
  return db.prepare(`UPDATE presence_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND revoked_at IS NULL`).run(id).changes > 0;
}

function apply(ev: PresenceEvent) {
  const now = ev.ts;
  const id = String(ev.session_id || `${ev.owner}:${ev.source}`);
  let s = sessions.get(id);
  if (!s) {
    s = {
      id, owner: ev.owner, source: ev.source || 'claude', project: ev.project || '', title: '', summary: '',
      status: 'idle', activity: '', started_at: now, last_at: now, last_human_at: null, ended_at: null,
      active_ms: 0, clickup_task: null, subagents: {}, counter: null,
    };
    sessions.set(id, s);
  }
  // sesja należy do właściciela tokenu, z którego przyszła jako pierwsza
  if (s.owner !== ev.owner) return;
  const gap = now - s.last_at;
  if (!s.ended_at && s.status !== 'idle' && gap > 0) s.active_ms += Math.min(gap, GAP_CAP_MS);
  s.last_at = now;
  if (ev.event === 'start') s.ended_at = null;

  for (const k of ['project', 'title', 'summary', 'status', 'activity', 'clickup_task', 'counter'] as const) {
    if (ev[k] !== undefined && ev[k] !== '') (s as any)[k] = ev[k];
  }
  if (ev.human) s.last_human_at = now;
  if (ev.subagent_start) s.subagents[ev.subagent_start.id] = ev.subagent_start.type || 'agent';
  if (ev.subagent_stop) delete s.subagents[ev.subagent_stop];
  if (ev.event === 'end') { s.ended_at = now; s.status = 'done'; s.subagents = {}; }
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined);

// Tylko znane pola o ograniczonej długości: zdarzenie przychodzi z komputera członka zespołu.
export function recordEvent(token: PresenceToken, body: Record<string, any>) {
  if (body.source && !SOURCES.includes(body.source)) throw new Error('source');
  if (body.status && !STATUSES.includes(body.status)) throw new Error('status');
  const ev: PresenceEvent = {
    ts: Date.now(),
    owner: ownerOf(token),
    session_id: str(body.session_id, 80),
    source: token.kind === 'bot' ? 'bot' : body.source || 'claude',
    project: str(body.project, 80),
    title: str(body.title, 80),
    summary: str(body.summary, 200),
    status: body.status,
    activity: str(body.activity, 60),
    event: body.event === 'start' || body.event === 'end' ? body.event : undefined,
    human: body.human === true || undefined,
  };
  if (body.clickup_task?.id) ev.clickup_task = { id: String(body.clickup_task.id).replace(/[^\w-]/g, '').slice(0, 40) };
  if (body.counter && typeof body.counter === 'object') ev.counter = { label: str(body.counter.label, 40), value: Number(body.counter.value) || 0 };
  if (body.subagent_start?.id) ev.subagent_start = { id: str(String(body.subagent_start.id), 80), type: str(body.subagent_start.type, 40) };
  if (body.subagent_stop) ev.subagent_stop = str(String(body.subagent_stop), 80);
  for (const k of Object.keys(ev)) if (ev[k] === undefined) delete ev[k];

  apply(ev);
  db.prepare(`INSERT INTO presence_events (ts, payload) VALUES (?, ?)`).run(ev.ts, JSON.stringify(ev));
  db.prepare(`UPDATE presence_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?`).run(token.id);
}

function view(s: Session, now: number, taskName: (id: string) => string | null) {
  const age = now - s.last_at;
  let status = s.status;
  let ended_at = s.ended_at;
  if (!ended_at && age > STALE_MS) { ended_at = s.last_at; status = 'done'; }
  else if (!ended_at && age > IDLE_MS && status !== 'waiting') status = 'idle';
  const live = !ended_at && status !== 'idle' ? Math.min(age, GAP_CAP_MS) : 0;
  return {
    id: s.id, owner: s.owner, source: s.source, project: s.project, title: s.title, summary: s.summary,
    status, activity: s.activity, started_at: s.started_at, ended_at,
    active_ms: s.active_ms + live,
    clickup_task: s.clickup_task ? { id: s.clickup_task.id, name: taskName(s.clickup_task.id) } : null,
    subagents: Object.values(s.subagents),
    human_recent: s.last_human_at ? now - s.last_human_at < IDLE_MS : false,
    counter: s.counter,
  };
}

// Stan dla zakładki Biuro: osoby z tokenem albo z timerem ClickUp dziś, ich sesje dziś. Bez stawek i zarobków.
export function presenceState() {
  const now = Date.now();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const t0 = today.getTime();

  const taskStmt = db.prepare(`SELECT name FROM tasks WHERE id = ?`);
  const taskName = (id: string) => (taskStmt.get(id) as { name?: string } | undefined)?.name || null;

  const list = [...sessions.values()].map((s) => view(s, now, taskName))
    .filter((s) => !s.ended_at || s.ended_at >= t0);

  type Person = { id: string; name: string; kind: string; model: string; recolor: unknown };
  const people = new Map<string, Person>();
  const tokens = db.prepare(`
    SELECT t.id, t.name, t.kind, t.app_user_id, t.model, t.recolor, u.display_name, u.username
    FROM presence_tokens t LEFT JOIN app_users u ON u.id = t.app_user_id
    WHERE t.revoked_at IS NULL AND (u.id IS NULL OR u.is_active = 1)
    ORDER BY t.id
  `).all() as Array<PresenceToken & { display_name: string | null; username: string | null }>;
  for (const t of tokens) {
    const id = ownerOf(t);
    if (people.has(id)) continue;
    let recolor = null;
    try { recolor = t.recolor ? JSON.parse(t.recolor) : null; } catch { /* zły JSON = bez zmian koloru */ }
    people.set(id, { id, name: t.name || t.display_name || "", kind: t.kind, model: t.model, recolor });
  }

  // timery ClickUp: aktywne teraz i zakończone dziś, przypisane do kont aplikacji
  const entries = db.prepare(`
    SELECT te.id, te.task_id, te.task_name, te.start_time, te.end_time, te.list_name, au.id AS app_user_id,
           COALESCE(au.display_name, au.username, te.user_name) AS name
    FROM time_entries te
    JOIN app_users au ON au.clickup_user_id = te.user_id AND au.is_active = 1
    LEFT JOIN users u ON u.id = te.user_id
    WHERE COALESCE(u.hidden, 0) = 0 AND (te.end_time IS NULL OR te.end_time >= ?)
  `).all(today.toISOString()) as Array<{ id: string; task_id: string; task_name: string; start_time: string; end_time: string | null; list_name: string; app_user_id: number; name: string }>;
  for (const e of entries) {
    const owner = `u${e.app_user_id}`;
    const start = Date.parse(e.start_time);
    const end = e.end_time ? Date.parse(e.end_time) : null;
    if (end === null && now - start > 12 * 3600e3) continue; // zapomniany timer nie robi z nikogo pracującego
    if (!people.has(owner)) people.set(owner, { id: owner, name: e.name, kind: 'human', model: 'character-male-f', recolor: null });
    list.push({
      id: `cu:${e.id}`, owner, source: 'clickup', project: e.list_name || '', title: e.task_name || 'zadanie ClickUp', summary: '',
      status: end ? 'done' : 'working', activity: end ? '' : 'timer ClickUp', started_at: start, ended_at: end,
      active_ms: (end ?? now) - Math.max(start, t0),
      clickup_task: e.task_id ? { id: e.task_id, name: e.task_name } : null,
      subagents: [], human_recent: !end, counter: null,
    });
  }

  return { now, people: [...people.values()], sessions: list.filter((s) => people.has(s.owner)) };
}
