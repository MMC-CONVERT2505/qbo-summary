import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

/**
 * File-backed key/value store for OAuth tokens and cached summaries.
 *
 * This is deliberately simple so the project runs with zero infrastructure.
 * Before production: move tokens into Postgres (or your secret manager) and
 * encrypt the refresh token at rest — it is a long-lived credential.
 */
const file = (name) => path.join(config.dataDir, `${name}.json`);

async function readAll(name) {
  try {
    return JSON.parse(await fs.readFile(file(name), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

/**
 * Writes the whole file via a temp-file-then-rename, not a direct write —
 * `rename` is atomic on both Windows and POSIX, so a crash or concurrent
 * reader never sees a half-written file (fs.writeFile alone can truncate
 * the file before the new bytes land, if the process dies mid-write).
 */
async function writeAll(name, data) {
  await fs.mkdir(config.dataDir, { recursive: true });
  const target = file(name);
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, target);
}

/**
 * get/set/remove are each read-modify-write across the *whole* file, with
 * no locking of their own — two calls against the same store name that
 * overlap (e.g. two users' summary builds finishing seconds apart) can
 * interleave: both read the same starting state, both write, and whichever
 * write lands second silently erases the first one's change. Concurrency
 * only happens within this one Node process (no multi-process/horizontal
 * scaling here), so an in-memory lock is enough — no file-lock package
 * needed. Each store `name` (tokens, summaries) gets its own queue, so
 * unrelated stores never wait on each other.
 */
const queues = new Map();

function serialize(name, task) {
  const prior = queues.get(name) ?? Promise.resolve();
  const settled = prior.then(task, task);
  // Keep the chain alive even if `task` rejects — swallow here so a failed
  // operation doesn't permanently wedge every later call for this name;
  // the real error still propagates to whoever awaited `settled`.
  queues.set(name, settled.catch(() => {}));
  return settled;
}

export const store = {
  async get(name, key) {
    return serialize(name, async () => (await readAll(name))[key] ?? null);
  },
  async set(name, key, value) {
    return serialize(name, async () => {
      const all = await readAll(name);
      all[key] = value;
      await writeAll(name, all);
      return value;
    });
  },
  async remove(name, key) {
    return serialize(name, async () => {
      const all = await readAll(name);
      delete all[key];
      await writeAll(name, all);
    });
  },
  async keys(name) {
    return serialize(name, async () => Object.keys(await readAll(name)));
  },
};
