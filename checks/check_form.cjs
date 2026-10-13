const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
for (const lang of ['ru','en','de','kk']) {
  const nodes = {};
  for (const id of ['draft-form','anonymous','name','email','message','download','draft-status']) {
    nodes[id] = { value:'', disabled:false, checked:false, textContent:'', handlers:{}, addEventListener(k,f){this.handlers[k]=f;}, setCustomValidity(v){this.error=v;} };
  }
  nodes['draft-form'].reportValidity=()=>!nodes.message.error && (nodes.email.disabled || !nodes.email.value || nodes.email.value.includes('@'));
  let blob, clicks=0, removed=0, revoked=0;
  const context={document:{documentElement:{lang},querySelector:s=>nodes[s.slice(1)],body:{append(){}},createElement:()=>({click(){clicks++;},remove(){removed++;}})},Blob:class{constructor(parts){blob=parts.join('');}},URL:{createObjectURL:()=> 'blob:local',revokeObjectURL(){revoked++;}},window:{setTimeout:f=>f()}};
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../assets/app.js'),'utf8'),context);
  assert.equal(nodes.download.disabled,false);
  let prevented=false; nodes['draft-form'].handlers.submit({preventDefault(){prevented=true;}}); assert(prevented);
  nodes.message.value='   '; nodes.download.handlers.click(); assert.equal(clicks,0);
  nodes.message.value='A memory'; nodes.message.handlers.input();
  nodes.name.value='Private name'; nodes.email.value='invalid'; nodes.download.handlers.click(); assert.equal(clicks,0);
  nodes.anonymous.checked=true; nodes.anonymous.handlers.change();
  assert(nodes.name.disabled && nodes.email.disabled); nodes.download.handlers.click();
  assert.equal(clicks,1); assert(!blob.includes('Private name') && !blob.includes('invalid')); assert(blob.includes('A memory'));
  nodes.anonymous.checked=false; nodes.anonymous.handlers.change(); nodes.email.value='test@example.test'; nodes.download.handlers.click();
  assert.equal(clicks,2); assert(blob.includes('Private name') && blob.includes('test@example.test')); assert.equal(removed,2); assert.equal(revoked,2);
  console.log(`PASS ${lang}: no submit, blank/email validation, anonymous export, named export, URL cleanup`);
}
