import session from 'express-session';
import { store } from './store.js';

/**
 * Session storage backed by the same file store as tokens and summaries.
 *
 * express-session's default MemoryStore keeps sessions in RAM, which has two
 * consequences in production: it leaks memory (nothing ever prunes it), and
 * every restart drops every session. That second one matters a lot here —
 * `requireRealm` now resolves the company strictly from the session, so a
 * restart would send every user back through the whole QuickBooks OAuth
 * flow. Deploys restart the container, so that would be *every deploy*.
 *
 * Writing through `store` rather than a new dependency means sessions inherit
 * the same per-file locking and atomic temp-file-then-rename writes, so two
 * concurrent requests can't clobber each other's session.
 *
 * This is a single-process store — good for one container. If this ever runs
 * as multiple replicas behind a load balancer, move sessions to Redis; each
 * replica would otherwise keep writing over the others' view of the file.
 */
const STORE_NAME = 'sessions';

export class FileSessionStore extends session.Store {
  constructor({ pruneIntervalMs = 60 * 60 * 1000 } = {}) {
    super();
    // Sweep expired sessions hourly so the file doesn't grow without bound.
    // unref() so this timer never holds the process open during shutdown.
    this.pruneTimer = setInterval(() => this.prune().catch(() => {}), pruneIntervalMs);
    this.pruneTimer.unref?.();
  }

  async get(sid, callback) {
    try {
      const record = await store.get(STORE_NAME, sid);
      if (!record) return callback(null, null);
      // Treat an expired record as absent, and clean it up on the way past.
      if (record.expiresAt && Date.now() > record.expiresAt) {
        await store.remove(STORE_NAME, sid);
        return callback(null, null);
      }
      return callback(null, record.data);
    } catch (err) {
      return callback(err);
    }
  }

  async set(sid, sessionData, callback) {
    try {
      await store.set(STORE_NAME, sid, {
        data: sessionData,
        expiresAt: expiryOf(sessionData),
      });
      return callback?.(null);
    } catch (err) {
      return callback?.(err);
    }
  }

  async destroy(sid, callback) {
    try {
      await store.remove(STORE_NAME, sid);
      return callback?.(null);
    } catch (err) {
      return callback?.(err);
    }
  }

  /**
   * Called on every request for an existing session when `rolling`/`resave`
   * semantics need the expiry pushed out. Without it, express-session falls
   * back to rewriting the whole session on each request.
   */
  async touch(sid, sessionData, callback) {
    try {
      const record = await store.get(STORE_NAME, sid);
      if (record) {
        record.expiresAt = expiryOf(sessionData);
        await store.set(STORE_NAME, sid, record);
      }
      return callback?.(null);
    } catch (err) {
      return callback?.(err);
    }
  }

  async prune() {
    const now = Date.now();
    for (const sid of await store.keys(STORE_NAME)) {
      const record = await store.get(STORE_NAME, sid);
      if (record?.expiresAt && now > record.expiresAt) {
        await store.remove(STORE_NAME, sid);
      }
    }
  }
}

/** Absolute expiry timestamp for a session, from its cookie. */
function expiryOf(sessionData) {
  const cookie = sessionData?.cookie;
  if (cookie?.expires) return new Date(cookie.expires).getTime();
  if (cookie?.originalMaxAge) return Date.now() + cookie.originalMaxAge;
  return null;
}
