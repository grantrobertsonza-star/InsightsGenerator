// Pure guard checks: no DB imports, connections or writes.
import assert from 'node:assert/strict';
import {targets} from './safety.mjs';
const env={REPIN002_ALLOW_DISPOSABLE_WRITES:'YES',REPIN002_APP_URL:'postgres://app:synthetic@127.0.0.1:55494/repin002_check',REPIN002_ADMIN_URL:'postgres://setup:synthetic@127.0.0.1:55494/repin002_check',REPIN002_ENVIRONMENT_ID:'repin002-check'};
assert.throws(()=>targets({}),/disabled/);
assert.equal(targets(env).id,'repin002-check');
assert.throws(()=>targets({...env,REPIN002_APP_URL:'postgres://app:x@remote.example:5432/repin002_check'}),/loopback/);
assert.throws(()=>targets({...env,REPIN002_APP_URL:'postgres://app:x@127.0.0.1:55494/postgres'}),/dedicated/);
assert.throws(()=>targets({...env,REPIN002_ADMIN_URL:env.REPIN002_APP_URL}),/different roles/);
assert.throws(()=>targets({...env,REPIN002_ADMIN_URL:'postgres://setup:x@127.0.0.1:55495/repin002_other'}),/same disposable/);
console.log('6 pure target-guard checks passed; no DB or storage access');
