// Test-only target guard. Does not read DATABASE_URL, .env or application credentials.
const local = new Set(['127.0.0.1', 'localhost', '[::1]']);
export function targets(env = process.env) {
  if (env.P2A_ALLOW_DISPOSABLE_WRITES !== 'YES') throw Error('P2a writes are disabled; separate authorization and explicit opt-in required.');
  const database = new URL(env.P2A_DATABASE_URL || 'missing:');
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || !local.has(database.hostname) || !database.port || !/^\/p2a_[a-z0-9_]+$/.test(database.pathname)) {
    throw Error('Require explicit loopback PostgreSQL port and a dedicated p2a_* database.');
  }
  const storage = new URL(env.P2A_STORAGE_URL || 'missing:');
  if (storage.protocol !== 'http:' || !local.has(storage.hostname) || !storage.port) throw Error('Require explicit loopback disposable storage URL/port.');
  const browser = new URL(env.P2A_BROWSER_URL || 'missing:');
  if (browser.protocol !== 'http:' || !local.has(browser.hostname) || !browser.port) throw Error('Require explicit loopback browser URL/port.');
  if (!env.P2A_STORAGE_TEST_KEY) throw Error('Supply a newly generated local test storage key; never a live key.');
  if (!/^p2a-[a-z0-9-]+$/.test(env.P2A_STORAGE_BUCKET || '')) throw Error('Require an isolated p2a-* bucket.');
  if (!/^p2a-[a-z0-9-]+$/.test(env.P2A_ENVIRONMENT_ID || '')) throw Error('Require the environment marker installed during disposable setup.');
  return { databaseUrl: database.href, storageUrl: storage.href.replace(/\/$/, ''), browserUrl: browser.href,
    key: env.P2A_STORAGE_TEST_KEY, bucket: env.P2A_STORAGE_BUCKET, environmentId: env.P2A_ENVIRONMENT_ID };
}
