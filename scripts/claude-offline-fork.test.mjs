import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {afterEach,test} from 'node:test';
const roots=[];
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'claude-fork-recovery-'));roots.push(root);
 const project=path.join(root,'projects','-fixture');fs.mkdirSync(project,{recursive:true});
 const id=randomUUID(),u=randomUUID(),a=randomUUID();
 fs.writeFileSync(path.join(project,id+'.jsonl'),[
  {type:'user',uuid:u,parentUuid:null,sessionId:id,cwd:root,isSidechain:false,timestamp:'2026-01-01T00:00:00Z',message:{role:'user',content:'fixture question'}},
  {type:'assistant',uuid:a,parentUuid:u,sessionId:id,cwd:root,isSidechain:false,timestamp:'2026-01-01T00:00:01Z',message:{role:'assistant',content:[{type:'text',text:'fixture answer'}]}}
 ].map(row=>JSON.stringify(row)).join('\n')+'\n');
 const resultFile=path.join(root,'result.json');
 const run=(cutoff='')=>JSON.parse(execFileSync('/usr/bin/python3',[fileURLToPath(new URL('./claude-offline-network-guard.py',import.meta.url)),process.execPath,'--max-old-space-size=256',fileURLToPath(new URL('./claude-offline-fork.mjs',import.meta.url)),id,'','fixture fork',cutoff],{env:{...process.env,CLAUDE_CONFIG_DIR:root,CLAUDE_FORK_RESULT_FILE:resultFile},encoding:'utf8',stdio:['ignore','pipe','pipe']}));
 return{root,project,id,resultFile,run};
}
test('recovers the same SDK fork after lost result acknowledgement without making another native session',()=>{
 const f=fixture(),first=f.run();assert.notEqual(first.sessionId,f.id);assert.equal(fs.readdirSync(f.project).length,2);
 assert.equal(f.run().sessionId,first.sessionId);
 fs.unlinkSync(f.resultFile); // SDK completed, durable result acknowledgement was lost.
 assert.equal(f.run().sessionId,first.sessionId);assert.equal(fs.readdirSync(f.project).length,2);
 assert.equal(fs.existsSync(f.resultFile+'.lock'),false);
 assert.throws(()=>f.run(randomUUID()));assert.equal(fs.readdirSync(f.project).length,2);
});
test('never starts a second fork when a previous private staging result is incomplete',()=>{
 const f=fixture(),id=randomUUID();
 fs.writeFileSync(path.join(f.project,id+'.jsonl'),JSON.stringify({type:'user',uuid:randomUUID(),sessionId:id,forkedFrom:{sessionId:f.id},message:{role:'user',content:'partial'}})+'\n');
 assert.throws(()=>f.run(),error=>String(error.stderr).includes('incomplete')||String(error.stderr).includes('uncertain'));
 assert.equal(fs.readdirSync(f.project).length,2);assert.equal(fs.existsSync(f.resultFile),false);
});
