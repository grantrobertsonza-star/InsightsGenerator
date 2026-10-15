import {test} from 'node:test';
import assert from 'node:assert/strict';
import {targets} from './safety.mjs';
const valid={P2A_ALLOW_DISPOSABLE_WRITES:'YES',P2A_DATABASE_URL:'postgres://tester:synthetic@127.0.0.1:55493/p2a_synthetic',P2A_STORAGE_URL:'http://127.0.0.1:55494',P2A_BROWSER_URL:'http://127.0.0.1:3301',P2A_STORAGE_TEST_KEY:'synthetic-not-a-real-key',P2A_STORAGE_BUCKET:'p2a-synthetic',P2A_ENVIRONMENT_ID:'p2a-synthetic'};
test('disabled by default; ambient live variables cannot enable it',()=>assert.throws(()=>targets({DATABASE_URL:'postgres://live.example/live'})));
test('accepts explicit synthetic loopback targets',()=>assert.equal(targets(valid).bucket,'p2a-synthetic'));
test('rejects remote database and ordinary development database names',()=>{for(const url of ['postgres://test@remote.example:5432/p2a_test','postgres://test@127.0.0.1:5432/postgres'])assert.throws(()=>targets({...valid,P2A_DATABASE_URL:url}));});
test('rejects remote storage/browser, absent key and ordinary bucket',()=>{for(const patch of [{P2A_STORAGE_URL:'https://remote.example:443'},{P2A_BROWSER_URL:'http://remote.example:3000'},{P2A_STORAGE_TEST_KEY:''},{P2A_STORAGE_BUCKET:'documents'}])assert.throws(()=>targets({...valid,...patch}));});
