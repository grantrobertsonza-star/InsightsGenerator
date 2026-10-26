// Preparation-only guards; never load .env or DATABASE_URL.
const local=new Set(['127.0.0.1','localhost','[::1]']);
export function targets(env=process.env){
 if(env.REPIN002_ALLOW_DISPOSABLE_WRITES!=='YES')throw Error('REP-IN-002 writes disabled; separate authorization required');
 const parse=(key)=>{const u=new URL(env[key]||'missing:');if(!['postgres:','postgresql:'].includes(u.protocol)||!local.has(u.hostname)||!u.port||!/^\/repin002_[a-z0-9_]+$/.test(u.pathname))throw Error('Require explicit loopback port and dedicated repin002_* database');return u};
 const app=parse('REPIN002_APP_URL'),admin=parse('REPIN002_ADMIN_URL');
 if(app.host!==admin.host||app.pathname!==admin.pathname||app.username===admin.username)throw Error('Admin/app must name same disposable target with different roles');
 if(!/^repin002-[a-z0-9-]+$/.test(env.REPIN002_ENVIRONMENT_ID||''))throw Error('Require repin002 environment marker');
 return {app:app.href,admin:admin.href,id:env.REPIN002_ENVIRONMENT_ID};
}
