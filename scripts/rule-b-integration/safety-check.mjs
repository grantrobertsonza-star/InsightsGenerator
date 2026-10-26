// Pure checks only; imports no pg, Docker, filesystem target or browser client.
import assert from 'node:assert/strict';
import {targets,environment} from './safety.mjs';
const ok={RULEB_ALLOW_DISPOSABLE_WRITES:'YES',RULEB_ENVIRONMENT_ID:environment,RULEB_ADMIN_URL:'postgres://postgres@127.0.0.1:55500/ruleb_20261015_core',RULEB_APP_URL:'postgres://ruleb_core_app@127.0.0.1:55500/ruleb_20261015_core'};
assert.equal(new URL(targets(ok).app).hostname,'127.0.0.1');
for(const patch of [
 {RULEB_ALLOW_DISPOSABLE_WRITES:'NO'},
 {RULEB_ENVIRONMENT_ID:'repin002-final-20261015'},
 {RULEB_APP_URL:'postgres://ruleb_core_app@remote.example:55500/ruleb_20261015_core'},
 {RULEB_APP_URL:'postgres://ruleb_core_app@127.0.0.1:5432/ruleb_20261015_core'},
 {RULEB_APP_URL:'postgres://ruleb_core_app@127.0.0.1:55500/development'},
 {RULEB_APP_URL:'postgres://postgres@127.0.0.1:55500/ruleb_20261015_core'},
 {RULEB_ADMIN_URL:'postgres://postgres@127.0.0.1:55500/ruleb_20261015_core?host=other'},
])assert.throws(()=>targets({...ok,...patch}));
console.log('8 pure target checks passed; no connections or writes.');
