import { spawn, execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { DatabaseSync } from 'node:sqlite';
import { SQLiteD1 } from '../local/sqlite-d1.mjs';
import { applyMigrations } from '../local/migrations.mjs';
import { createCreativeBrief } from '../worker/core.mjs';

const root = process.cwd();
const phase = process.env.DRAMAGO_ACCEPTANCE_PHASE || 'after-dev';
const before = phase.startsWith('before');
const output = path.join(root, 'reports/final-user-acceptance', phase);
const runRoot = await mkdtemp(path.join(root, '.cache/final-user-acceptance-'));
const dataRoot = path.join(runRoot, 'data');
const userData = path.join(runRoot, 'electron');
const exports = path.join(runRoot, 'exports');
await Promise.all([mkdir(output, { recursive: true }), mkdir(path.join(dataRoot, 'data'), { recursive: true }), mkdir(exports)]);
const statusFile = path.join(runRoot, 'status.json');
const hash = (text) => createHash('sha256').update(text).digest('hex');
const db = new SQLiteD1(path.join(dataRoot, 'data/dramago.sqlite'));
await applyMigrations(db, path.join(root, 'drizzle'));
const title = '合成验收故事';
const workId = 'acceptance-synthetic';
const paragraphs = ['你叫沈言，是赵明与许岚之子。', '你的母亲许岚留下了一张便条。你的父亲赵明在楼下等你。',
  '你向酒吧负责人杜师傅申请工作。', '你仍需寻找一份稳定工作。',
  ...Array.from({ length: 30 }, (_, i) => `第${i + 1}段，你把经历记在蓝色笔记本上。窗外有人走过，你重新整理桌上的信件，决定先完成眼前的小事。这是独立的合成测试文本。`)];
const contents = Object.fromEntries([1, 2, 3, 4, 5].map((n) => [n, paragraphs.join('\n\n') + `\n\n第${n}版的收束：你关上笔记本。`]));
const segment = '第二天，你仍需寻找一份稳定工作。\n\n你还没有决定是否回到旧城市。';
const candidateContent = contents[5] + '\n\n' + segment;
const time = (n) => `2026-10-01T00:00:${String(n).padStart(2, '0')}.000Z`;
await db.prepare('INSERT INTO works (id,title,current_version_id,created_at,updated_at) VALUES (?,?,?,?,?)')
  .bind(workId, title, 'accept-v5', time(0), time(5)).run();
await db.prepare("INSERT INTO works(id,title,current_version_id,created_at,updated_at) VALUES ('other-work','另一部隔离作品','other-version',?,?)").bind(time(0),time(0)).run();
await db.prepare("INSERT INTO versions(id,work_id,operation,status,title,content,creative_brief_json,checks_json,created_at) VALUES ('other-version','other-work','MANUAL_EDIT','adopted','另一部隔离作品','另一部作品的合成正文。','{}','[]',?)").bind(time(0)).run();
for (let n = 1; n <= 5; n++) await db.prepare(`INSERT INTO versions (id,work_id,parent_version_id,operation,status,title,content,
  creative_brief_json,checks_json,content_hash,validation_status,can_auto_apply,adopted_at,created_at)
  VALUES (?,?,?,'MANUAL_EDIT','adopted',?,?,'{}','[]',?,'pending',0,?,?)`)
  .bind(`accept-v${n}`, workId, n === 1 ? null : `accept-v${n === 3 ? 1 : n - 1}`, title, contents[n], hash(contents[n]), time(n), time(n)).run();
const brief = createCreativeBrief({ operation: 'CONTINUE', source_version_id: 'accept-v5',
  target_scope: { type: 'next_segment' }, user_instruction: '从第二天开始，只追加新剧情。', output_preferences: { target_length: 100 } });
const memory = { completeness: 'available', characters: [], events: [], persistent_facts: [],
  open_threads: ['你仍需寻找一份稳定工作', '你还没有决定是否回到旧城市'].map((thread, i) => ({ id: `thread-${i}`, thread,
    status: 'open', truth_status: 'objective', certainty: 'confirmed', evidence: [{ quote: thread, start: candidateContent.lastIndexOf(thread), end: candidateContent.lastIndexOf(thread) + thread.length }] })) };
const semantic = { findings: [], blockingConflicts: [], warnings: [], requiredOutcomesMet: true,
  preserveStatus: { hard_met: true, soft_met: true, notes: [] }, promisePayoffStatus: { met: true, missingPayoffs: [], notes: [] },
  negativeConstraintStatus: { met: true, severity: 'pass', violations: [] }, candidateInternalConsistency: { consistent: true, conflicts: [] },
  operationCompleted: true, candidateStoryMemory: memory };
await db.prepare(`INSERT INTO versions (id,work_id,parent_version_id,operation,status,title,content,generated_segment,
  creative_brief_json,checks_json,content_hash,validator_version,validation_status,can_auto_apply,validated_at,
  validator_provider_id,validator_model_id,current_validation_run_id,created_at)
  VALUES ('accept-v6',?,'accept-v5','CONTINUE','candidate',?,?,?,?,'[]',?,'content-semantic-v2.2-language','passed',0,?,
  'deepseek','deepseek-flash','accept-run',?)`).bind(workId,title,candidateContent,segment,JSON.stringify(brief),hash(candidateContent),time(8),time(6)).run();
await db.prepare(`INSERT INTO generation_tasks (id,work_id,source_version_id,creative_brief_json,source_hash,status,provider,model_name,
  result_version_id,created_at,completed_at,prompt_template_id,merge_strategy,output_kind,candidate_content_hash,validator_version,
  validation_status,source_is_current,execution_input_json,stage,updated_at)
  VALUES ('accept-task',?,'accept-v5',?,?,'completed','controlled','controlled','accept-v6',?,?,'creative-writer-v2',
  'PROGRAM_APPEND','continuation',?,'content-semantic-v2.2-language','passed',1,?,'completed',?)`)
  .bind(workId,JSON.stringify(brief),hash(`${title}\n${contents[5]}`),time(6),time(8),hash(candidateContent),JSON.stringify({brief,context:''}),time(8)).run();
await db.prepare(`INSERT INTO candidate_validation_runs (id,task_id,work_id,candidate_version_id,candidate_content_hash,
  source_version_id,source_content_hash,operation,trigger,validator_version,provider_id,model_name,status,checks_json,
  semantic_validation_json,confirmed_cost_risk,outcome_unknown,retry_confirmation_required,created_at,completed_at)
  VALUES ('accept-run','accept-task',?,'accept-v6',?,'accept-v5',?,'CONTINUE','user_revalidation',
  'content-semantic-v2.2-language','deepseek','deepseek-flash','passed','[]',?,1,0,0,?,?)`)
  .bind(workId,hash(candidateContent),hash(contents[5]),JSON.stringify(semantic),time(7),time(8)).run();
const oldMemory = { completeness: 'available', characters: ['沈言','赵明','许岚','杜师傅'].map((name,i)=>({id:`person-${i}`,name,
  identity:i===0?'主角':'',certainty:'confirmed',truth_status:'objective',status:'active',evidence:[{quote:name,start:contents[5].indexOf(name),end:contents[5].indexOf(name)+name.length,version_id:'accept-v5'}]})), events:[],persistent_facts:[],open_threads:[] };
await db.prepare(`INSERT INTO story_memory_snapshots (id,work_id,version_id,content_hash,memory_json,memory_status,extraction_source,created_at,updated_at)
  VALUES ('accept-memory',?,'accept-v5',?,?,'available','synthetic_old_snapshot',?,?)`).bind(workId,hash(contents[5]),JSON.stringify(oldMemory),time(5),time(5)).run();
db.close();
const portServer=createServer();await new Promise(r=>portServer.listen(0,'127.0.0.1',r));const port=portServer.address().port;await new Promise(r=>portServer.close(r));
const executable=process.env.DRAMAGO_ACCEPTANCE_EXE || path.join(root,'node_modules/electron/dist/electron.exe');
const packaged=Boolean(process.env.DRAMAGO_ACCEPTANCE_EXE);
const checks=[], screenshots=[];let browser, desktop;
function check(name, ok, detail=null) { checks.push({name,passed:Boolean(ok),detail});if(!ok&&!before)throw new Error(name+': '+JSON.stringify(detail)); }
async function capture(page,name){const file=path.join(output,`${name}.png`);await page.waitForTimeout(250);await page.screenshot({path:file});screenshots.push(file);}
async function openVersion(page,id){await page.locator('[data-action="open-history"]').first().click();await page.locator(`[data-version-id="${id}"]`).click();await page.locator('.candidate-story').waitFor();}
async function waitFor(predicate) { const until=Date.now()+10000;while(Date.now()<until){if(await predicate())return;await new Promise(r=>setTimeout(r,50));}throw new Error('Condition timed out'); }
async function readDb(sql,...args){const readOnly=new DatabaseSync(path.join(dataRoot,'data/dramago.sqlite'),{readOnly:true});try{return {results:readOnly.prepare(sql).all(...args)};}finally{readOnly.close();}}
async function exportFile(page,action,expected,content){
  const downloadPromise=page.waitForEvent('download');await page.locator(`[data-action="${action}"]`).first().click();
  const download=await downloadPromise;check(`export_name_${expected}`,download.suggestedFilename()===expected,download.suggestedFilename());
  await download.saveAs(path.join(exports,expected));check(`export_content_${expected}`,(await readFile(path.join(exports,expected),'utf8')).includes(content));
}
try {
  desktop=spawn(executable,[...(packaged?[]:['.']),`--remote-debugging-port=${port}`],{cwd:packaged?path.dirname(executable):root,windowsHide:true,stdio:'ignore',env:{...process.env,
    DRAMAGO_DATA_DIR:dataRoot,DRAMAGO_ELECTRON_USER_DATA:userData,DRAMAGO_DESKTOP_QA_STATUS:statusFile,
    DRAMAGO_INTERNAL_QA:'1',DRAMAGO_DESKTOP_QA_EXPORT_DIR:exports}});
  const deadline=Date.now()+30000;let ready=false;
  while(Date.now()<deadline){try{ready=JSON.parse(await readFile(statusFile,'utf8')).window_ready;if(ready)break;}catch{} await new Promise(r=>setTimeout(r,100));}
  check('electron_ready',ready);
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page=browser.contexts()[0].pages().find(p=>p.url().startsWith('http://127.0.0.1:'));
  await page.goto(new URL(`/?work_id=${workId}`,page.url()).href);
  await page.locator('[data-action="show-editor"]').first().click();await page.locator('#bodyEditor').waitFor();
  await page.setViewportSize({width:1366,height:900});
  await page.locator('#bodyEditor').fill(contents[5]+'\n\n手工新增的一句。');
  const saveLabel=await page.locator('[data-action="save-version"]').textContent();
  check('edited_body_shows_save_new_version',saveLabel.includes('保存新版本'),saveLabel);
  await page.evaluate(()=>window.scrollTo(0,0));
  await capture(page,'01-edited-save-state');
  await page.locator('#bodyEditor').fill(contents[5]);
  if(!before){
    check('undo_to_original_is_saved',await page.locator('[data-action="save-version"]').isDisabled());
    await page.locator('.composer-expand').click();
    await page.locator('#composerInput').fill('只改变本次 AI 要求，不改变正式正文。');
    check('instruction_does_not_dirty_body',await page.locator('[data-action="save-version"]').isDisabled());
    await page.locator('[data-action="toggle-composer"]').click();
  }
  await openVersion(page,'accept-v3');await page.locator('[data-action="show-compare"]').last().click();
  check('two_version_selectors',await page.locator('#compareBaseVersion').count()===1&&await page.locator('#compareTargetVersion').count()===1);
  await capture(page,'02-comparison');
  if(!before){
    check('compare_defaults_v1_v3',await page.locator('#compareBaseVersion').inputValue()==='accept-v1'&&await page.locator('#compareTargetVersion').inputValue()==='accept-v3');
    await page.locator('#compareTargetVersion').selectOption('accept-v5');await page.locator('#compareBaseVersion').selectOption('accept-v3');
    check('compare_v3_v5',await page.locator('#compareBaseVersion').inputValue()==='accept-v3'&&await page.locator('#compareTargetVersion').inputValue()==='accept-v5');
    await capture(page,'02b-v3-v5');
    await page.locator('#compareTargetVersion').selectOption('accept-v6');await page.locator('#compareBaseVersion').selectOption('accept-v5');
    check('compare_v5_v6_append_only',await page.locator('.continuation-added').count()===2&&await page.getByText('前文完整保留',{exact:true}).count()===1);
    await page.locator('[data-action="swap-compare"]').click();
    check('swapped_direction_removes_append',await page.locator('.diff-cell.removed').count()===4&&await page.locator('#compareBaseVersion').inputValue()==='accept-v6');
    const sameOption=await page.locator('#compareTargetVersion option[value="accept-v6"]').evaluate(el=>({disabled:el.disabled,html:el.outerHTML}));
    check('same_version_disabled',sameOption.disabled,sameOption);
    check('comparison_read_only',await page.locator('[data-action="adopt-candidate"],[data-action="confirm-history-restore"],#bodyEditor').count()===0);
    check('comparison_excludes_other_work',await page.locator('.compare-selectors option[value="other-version"]').count()===0);
    for(const width of [1366,1024,768,480]){
      await page.setViewportSize({width,height:900});await capture(page,`compare-${width}`);
      check(`compare_controls_in_view_${width}`,await page.locator('.compare-selectors').evaluate(el=>[...el.querySelectorAll('select,button')].every(x=>{const r=x.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.height>=40;})));
      check(`compare_footer_in_view_${width}`,await page.locator('.review-actions').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;}));
    }
    await page.setViewportSize({width:1366,height:900});
  }
  await openVersion(page,'accept-v6');await page.locator('[data-action="open-checks"]').first().click();
  await page.locator('[data-action="open-candidate-memory"]').click();
  const threads=page.locator('.candidate-memory-preview details').nth(3);await threads.locator('summary').click();
  await threads.locator('[data-evidence-version]').first().click();await page.locator('#sideSheet [data-action="close-overlay"]').click();
  check('evidence_return_keeps_expanded',await page.locator('.candidate-memory-preview details').nth(3).getAttribute('open')!==null);
  await capture(page,'03-evidence-return');
  await page.locator('#sideSheet [data-action="close-overlay"]').click();
  await page.locator('[data-action="open-candidate-memory"]').click();
  check('reopen_memory_keeps_expanded',await page.locator('.candidate-memory-preview details').nth(3).getAttribute('open')!==null);
  if(!before){
    for(let n=0;n<2;n++){
      const btn=page.locator('.candidate-memory-preview details').nth(3).locator('[data-evidence-version]').nth(n);
      await btn.focus();const scrollBefore=await page.locator('#sideSheet .sheet-body').evaluate(el=>el.scrollTop);
      await btn.click();await page.locator('#sideSheet [data-action="close-overlay"]').click();
      await page.waitForTimeout(50);
      check(`repeated_evidence_return_${n}`,await page.locator('.candidate-memory-preview details').nth(3).getAttribute('open')!==null
        &&Math.abs(await page.locator('#sideSheet .sheet-body').evaluate(el=>el.scrollTop)-scrollBefore)<3
        &&await btn.evaluate(el=>el===document.activeElement));
    }
  }
  await page.keyboard.press('Escape');await page.keyboard.press('Escape');
  await page.locator('[data-action="show-overview"]').first().click();await page.locator('.overview-canvas').waitFor();
  await capture(page,'04-overview');
  const overview=await page.evaluate(async(id)=>{const token=document.querySelector('meta[name="dramago-local-token"]').content;return(await fetch(`/api/works/${id}/overview`,{headers:{'x-dramago-local-token':token}})).json();},workId);
  checks.push({name:'relationship_baseline',detail:Object.fromEntries(Object.entries(overview.relationship_tree?.groups||{}).map(([k,v])=>[k,v.length]))});
  if(!before)check('tree_removed_memory_and_corrections_retained',await page.locator('.relationship-tree,[data-relationship-person],[data-action="add-memory-relationship"]').count()===0&&await page.locator('[data-memory-action="correct"]').count()>0);
  await page.locator('[data-action="show-editor"]').first().click();await page.locator('.composer-expand').click();
  await page.locator('#bodyEditor').evaluate((el)=>{const start=el.value.indexOf('你的母亲');el.focus();el.setSelectionRange(start,start+17);el.dispatchEvent(new Event('select',{bubbles:true}));});
  await page.locator('[data-selection-action="REWRITE"]').click();
  await capture(page,'05-selection-length');
  if(!before){
    check('local_rewrite_length_matches_17_character_selection',(await page.locator('[data-length-hint]').textContent()).includes('17'));
    let sent=null;
    await page.route('**/api/generate',async route=>{sent=route.request().postDataJSON();await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'CONTROLLED_OFFLINE',message:'隔离测试：网络不可用'}})});});
    await page.locator('#composerInput').fill('只调整选中的文字。');await page.locator('[data-action="generate"]').click();
    await waitFor(()=>sent!==null);await page.getByText('隔离测试：网络不可用',{exact:false}).first().waitFor();
    await page.locator('[data-action="show-editor"]').first().click();await page.locator('#bodyEditor').waitFor();
    const selectedStart=contents[5].indexOf('你的母亲');
    check('request_uses_selection_length_and_exact_utf16',sent.brief.output_preferences.target_length===17&&sent.brief.target_scope.start===selectedStart&&sent.brief.target_scope.end===selectedStart+17&&sent.brief.target_scope.selected_text===contents[5].slice(selectedStart,selectedStart+17),sent.brief);
    check('generation_failure_preserves_body_instruction',(await page.locator('#bodyEditor').inputValue())===contents[5]&&(await page.locator('#composerInput').inputValue())==='只调整选中的文字。');
    for(const [operation,length,scope] of [['EXPAND',34,'selection'],['CONTINUE',2000,'next_segment'],['CREATE',2000,'full']]){
      await page.locator(`[data-operation="${operation}"]`).click();sent=null;
      await page.locator('[data-action="generate"]').click();
      if(operation==='CREATE')await page.locator('[data-action="confirm-full-replacement"]').click();
      await waitFor(()=>sent!==null);await page.getByText('隔离测试：网络不可用',{exact:false}).first().waitFor();
      await page.locator('[data-action="show-editor"]').first().click();
      check(`request_length_${operation}`,sent.brief.operation===operation&&sent.brief.output_preferences.target_length===length&&sent.brief.target_scope.type===scope,{length:sent.brief.output_preferences.target_length,scope:sent.brief.target_scope.type});
    }
    await page.unroute('**/api/generate');
    await page.locator('[data-operation="CONTINUE"]').click();
    check('continue_clears_selection_toolbar',await page.locator('#selectionToolbar').isHidden()&&(await page.locator('[data-length-hint]').textContent()).includes('新增'));
    await page.locator('[data-action="toggle-composer"]').click();
    // Real textarea geometry: middle paragraph, visible tracking, out-of-view hiding and resize.
    await page.locator('#bodyEditor').evaluate(el=>{const start=el.value.indexOf('第8段');el.focus();el.setSelectionRange(start,start+120);el.dispatchEvent(new Event('select',{bubbles:true}));});
    await page.evaluate(()=>window.scrollTo(0,950));await page.waitForTimeout(100);
    await capture(page,'07-selection-scroll');
    check('middle_selection_toolbar_visible',await page.locator('#selectionToolbar').isVisible());
    const y1=(await page.locator('#selectionToolbar').boundingBox()).y;
    await page.evaluate(()=>window.scrollBy(0,70));await page.waitForTimeout(100);
    const y2=(await page.locator('#selectionToolbar').boundingBox()).y;
    check('toolbar_tracks_scroll',Math.abs((y1-y2)-70)<3,{y1,y2});
    await page.setViewportSize({width:1024,height:900});await page.waitForTimeout(100);
    // A resized selection may reflow outside the viewport; bring it back by actual scrolling.
    let visible=false;for(let y=0;y<3000;y+=150){await page.evaluate(y=>window.scrollTo(0,y),y);await page.waitForTimeout(30);const b=await page.locator('#selectionToolbar').boundingBox();if(b&&b.y>230&&b.y<600){visible=true;break;}}
    const resizedToolbar=await page.locator('#selectionToolbar').boundingBox();
    check('selection_reflows_on_resize',visible&&resizedToolbar.x>=0&&resizedToolbar.x+resizedToolbar.width<=1024,resizedToolbar);
    await capture(page,'07b-selection-resized');await page.setViewportSize({width:1366,height:900});
    await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(100);
    check('offscreen_selection_hides_toolbar',await page.locator('#selectionToolbar').isHidden());
    await page.locator('#bodyEditor').evaluate(el=>{el.setSelectionRange(0,0);el.dispatchEvent(new Event('select',{bubbles:true}));});
    check('cleared_selection_hides_toolbar',await page.locator('#selectionToolbar').isHidden());
  }
  await openVersion(page,'accept-v1');await page.locator('[data-action="request-history-authoring"]').last().click();
  await capture(page,'06-restore-confirmation');
  if(!before){
    check('restore_states_preserved_current_and_new_version',(await page.locator('#modalLayer').textContent()).includes('V5，将保留')&&(await page.locator('#modalLayer').textContent()).includes('创建新的正式版本'));
    await page.locator('#modalLayer [data-action="close-modal"]').click();
    for(const [id,label,text] of [['accept-v1','V1-历史稿',contents[1]],['accept-v6','V6-候选稿',candidateContent]]){
      await openVersion(page,id);await exportFile(page,'export-candidate',`${title}-${label}.md`,text);
    }
    await page.locator('[data-action="show-editor"]').first().click();await exportFile(page,'export-current',`${title}-V5-正式稿.md`,contents[5]);
    checks.push({name:'exported_files',detail:await readdir(exports)});
    // Save failure cannot masquerade as a formal commit.
    await page.route('**/api/versions/save',route=>route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:{code:'CONTROLLED_WRITE_FAILURE',message:'隔离测试保存失败'}})}));
    await page.locator('#bodyEditor').fill(contents[5]+'\n\n保存失败后必须保留。');await page.locator('[data-action="save-version"]').click();
    await page.getByText('隔离测试保存失败',{exact:false}).first().waitFor();
    check('save_failure_preserves_input_and_dirty',(await page.locator('#bodyEditor').inputValue()).endsWith('保存失败后必须保留。')&&(await page.locator('[data-action="save-version"]').textContent()).includes('保存新版本'));
    await capture(page,'08-save-failure');await page.unroute('**/api/versions/save');
    let saveCalls=0;await page.route('**/api/versions/save',async route=>{saveCalls++;await new Promise(r=>setTimeout(r,300));await route.continue();});
    await page.locator('#bodyEditor').fill(contents[5]+'\n\n正式提交的新句子。');
    await page.locator('[data-action="save-version"]').click();
    check('save_processing_label',await page.locator('[data-action="save-version"]').isDisabled()&&(await page.locator('[data-action="save-version"]').textContent()).includes('正在保存'));
    await page.keyboard.press('Control+s');await page.keyboard.press('Control+s');
    await waitFor(async()=> (await page.locator('[data-action="save-version"]').textContent())==='已保存');
    check('duplicate_click_one_version',saveCalls===1&&((await readDb('SELECT id FROM versions WHERE work_id=?',workId)).results.length===7));
    check('old_v1_preserved',(await readDb('SELECT content FROM versions WHERE id=?','accept-v1')).results[0].content===contents[1]);
    await page.evaluate(()=>window.scrollTo(0,0));
    await capture(page,'09-save-success');await page.unroute('**/api/versions/save');
    await page.reload();await page.locator('[data-action="show-editor"]').first().click();await page.locator('#bodyEditor').waitFor();
    check('reload_formal_save_persists',(await page.locator('#bodyEditor').inputValue()).endsWith('正式提交的新句子。')&&await page.locator('[data-action="save-version"]').isDisabled());
    // Editing while a save is in flight keeps the later draft instead of erasing it.
    let releaseSave;const releasePromise=new Promise(r=>{releaseSave=r;});
    await page.route('**/api/versions/save',async route=>{await releasePromise;await route.continue();});
    const firstSaveBody=contents[5]+'\n\n先提交的一句。',laterBody=firstSaveBody+'\n\n请求途中新输入。';
    await page.locator('#bodyEditor').fill(firstSaveBody);await page.locator('[data-action="save-version"]').click();
    await page.locator('#bodyEditor').fill(laterBody);releaseSave();
    await waitFor(async()=> (await page.locator('[data-action="save-version"]').textContent())==='保存新版本');
    check('inflight_save_preserves_newer_edit',(await page.locator('#bodyEditor').inputValue())===laterBody&&(await readDb('SELECT content FROM versions WHERE id=(SELECT current_version_id FROM works WHERE id=?)',workId)).results[0].content===firstSaveBody);
    await page.unroute('**/api/versions/save');await page.locator('[data-action="save-version"]').click();
    await waitFor(async()=> (await page.locator('[data-action="save-version"]').textContent())==='已保存');
    // Historical restoration is a real transaction and creates a new current version.
    await openVersion(page,'accept-v1');await page.locator('[data-action="request-history-authoring"]').last().click();
    await page.locator('[data-action="confirm-history-restore"]').click();await page.locator('#bodyEditor').waitFor();
    check('restore_creates_new_version_not_overwrite',(await page.locator('#bodyEditor').inputValue())===contents[1]&&(await readDb('SELECT current_version_id FROM works WHERE id=?',workId)).results[0].current_version_id!=='accept-v1');
    await page.locator('#bodyEditor').fill(contents[1]+'\n恢复后继续编辑。');
    check('restored_version_edit_shows_save',(await page.locator('[data-action="save-version"]').textContent())==='保存新版本');
    await page.locator('[data-action="save-version"]').click();await waitFor(async()=> (await page.locator('[data-action="save-version"]').textContent())==='已保存');
    for(const width of [1366,1024,768,480]){
      await page.setViewportSize({width,height:900});await page.locator('[data-action="new-work"]').first().click();
      check(`new_work_modal_bounds_${width}`,await page.locator('#modalLayer .modal').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&el.scrollWidth<=el.clientWidth;}));
      await capture(page,`modal-${width}`);await page.locator('#modalLayer [data-action="close-modal"]').first().click();
      await page.locator('[data-action="show-overview"]').first().click();await capture(page,`overview-${width}`);
      await page.locator('[data-action="show-editor"]').first().click();
    }
    await page.setViewportSize({width:1366,height:900});
    await page.locator('[data-action="new-work"]').first().click();await page.locator('#newWorkName').fill('手工版本与指令隔离验收');
    await page.locator('[data-action="confirm-new-work"]').click();
    await waitFor(()=>new URL(page.url()).searchParams.get('work_id')!==workId);
    await page.locator('#bodyEditor').waitFor();
    const manualWorkId=new URL(page.url()).searchParams.get('work_id');
    await page.locator('#bodyEditor').fill('这是第一版手工正文。');await page.locator('[data-action="save-version"]').click();
    await waitFor(async()=> (await page.locator('[data-action="save-version"]').textContent())==='已保存');
    await page.locator('#bodyEditor').fill('这是第二版手工正文。');await page.locator('[data-action="save-version"]').click();
    await waitFor(async()=> (await page.locator('[data-action="save-version"]').textContent())==='已保存');
    const manualVersions=(await readDb('SELECT id,parent_version_id,content FROM versions WHERE work_id=? ORDER BY created_at',manualWorkId)).results;
    check('v1_edit_creates_v2_retaining_v1',manualVersions.length===2&&manualVersions[0].content==='这是第一版手工正文。'&&manualVersions[1].content==='这是第二版手工正文。'&&manualVersions[1].parent_version_id===manualVersions[0].id,manualVersions);
    if(await page.locator('.composer-expand').count())await page.locator('.composer-expand').click();
    await page.locator('#composerInput').fill('仅属于第二部作品的创作指令。');
    await page.locator('[data-action="open-work-switcher"]').first().click();await page.locator(`[data-work-id="${workId}"]`).click();
    await page.locator('[data-action="show-editor"]').first().click();
    if(await page.locator('.composer-expand').count())await page.locator('.composer-expand').click();
    check('switch_keeps_first_work_separate',(await page.locator('#bodyEditor').inputValue())===contents[1]+'\n恢复后继续编辑。'&&(await page.locator('#composerInput').inputValue())!=='仅属于第二部作品的创作指令。');
    await page.locator('[data-action="open-work-switcher"]').first().click();await page.locator(`[data-work-id="${manualWorkId}"]`).click();
    if(await page.locator('.composer-expand').count())await page.locator('.composer-expand').click();
    check('switch_back_restores_second_work_instruction',(await page.locator('#bodyEditor').inputValue())==='这是第二版手工正文。'&&(await page.locator('#composerInput').inputValue())==='仅属于第二部作品的创作指令。');
    check('no_provider_transport',(await readDb('SELECT id FROM provider_transport_attempts')).results.length===0);
  }
} finally {
  await writeFile(path.join(output,'EVIDENCE.json'),JSON.stringify({phase,executable,isolated_data:dataRoot,checks,screenshots},null,2));
  await browser?.close().catch(()=>{});
  if(desktop?.pid)await promisify(execFile)('taskkill.exe',['/PID',String(desktop.pid),'/T','/F'],{windowsHide:true}).catch(()=>{});
}
console.log(JSON.stringify({phase,output,checks}));
