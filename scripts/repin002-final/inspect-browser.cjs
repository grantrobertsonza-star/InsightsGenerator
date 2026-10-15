
const {connect}=require('./cdp.cjs');
(async()=>{const c=await connect();try{console.log(JSON.stringify(await c.eval("({buttons:[...document.querySelectorAll('button')].map(b=>({text:b.innerText,type:b.type,visible:!!b.getClientRects().length})),inputs:[...document.querySelectorAll('input[type=file]')].map(i=>({name:i.name,visible:!!i.getClientRects().length})),links:[...document.querySelectorAll('a')].filter(a=>/Import|Report/.test(a.innerText)).map(a=>({text:a.innerText,href:a.getAttribute('href')}))})"),null,2));}finally{c.close()}})();
