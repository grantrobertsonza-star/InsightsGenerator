export const environment='ruleb-20261015-origin';
export function targets(env=process.env){
 if(env.RULEB_ALLOW_DISPOSABLE_WRITES!=='YES')throw Error('Writes disabled');
 if(env.RULEB_ENVIRONMENT_ID!==environment)throw Error('Wrong environment marker');
 const admin=new URL(env.RULEB_ADMIN_URL),app=new URL(env.RULEB_APP_URL);
 for(const u of [admin,app]){
  if(u.protocol!=='postgres:'||u.hostname!=='127.0.0.1'||u.port!=='55500'||u.pathname!=='/ruleb_20261015_core'||u.search||u.hash)throw Error('Unexpected database target');
 }
 if(admin.username!=='postgres'||app.username!=='ruleb_core_app')throw Error('Unexpected roles');
 return {admin:admin.href,app:app.href};
}
