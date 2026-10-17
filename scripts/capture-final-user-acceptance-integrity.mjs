import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const root=process.cwd();
const extracted=path.resolve('.cache/final-user-acceptance-from-zip-20261016/DramaGo-win32-x64');
const unpacked=path.join(extracted,'resources/app.asar.unpacked');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fileHash=async file=>sha(await readFile(file));
const assets=await import(pathToFileURL(path.join(unpacked,'dist/server/assets.mjs')).href);
const pairs=[['web/app.js',assets.workbenchJs],['web/styles.css',assets.workbenchCss],['web/index.html',assets.workbenchHtml]];
const checks=[];
for(const [file,text] of pairs){const source=await fileHash(file);checks.push({file,source_sha256:source,packaged_sha256:sha(text),match:source===sha(text)});}
for(const [file,packed] of [['worker/index.mjs','dist/server/index.js'],['worker/core.mjs','dist/server/core.mjs'],
  ['worker/relationship-classifier.mjs','dist/server/relationship-classifier.mjs'],['worker/provider-registry.mjs','dist/server/provider-registry.mjs'],
  ['local/server.mjs','local/server.mjs'],['local/sqlite-d1.mjs','local/sqlite-d1.mjs'],
  ...(await readdir('drizzle')).filter(x=>x.endsWith('.sql')).map(x=>['drizzle/'+x,'drizzle/'+x])]){
  const source=await fileHash(file), packaged=await fileHash(path.join(unpacked,packed));
  checks.push({file,source_sha256:source,packaged_sha256:packaged,match:source===packaged});
}
const unchanged=[];
for(const file of ['worker/core.mjs','worker/index.mjs','desktop/main.mjs','package.json']){
  unchanged.push({file,unchanged_from_g0:await fileHash(file)===await fileHash(path.join('.cache/user-acceptance-baseline-source',file))});
}
const manifest=JSON.parse(await readFile('artifacts/windows/portable-manifest-v1-4-final-user-acceptance-fix.json','utf8'));
const archive=path.resolve(manifest.archive);
const evidence={checked_at:new Date().toISOString(),branch:execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),
  head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),git_status:execFileSync('git',['status','--short'],{encoding:'utf8'}),
  archive,archive_bytes:(await stat(archive)).size,archive_sha256:await fileHash(archive),manifest_sha256:manifest.archive_sha256,
  packaged_at:manifest.created_at,executable:path.join(extracted,'DramaGo.exe'),electron:manifest.electron,signed:manifest.signed,
  extracted_assets_sha256:await fileHash(path.join(unpacked,'dist/server/assets.mjs')),checks,unchanged};
await writeFile('reports/final-user-acceptance/PACKAGE_INTEGRITY.json',JSON.stringify(evidence,null,2));
if(checks.some(x=>!x.match)||unchanged.some(x=>!x.unchanged_from_g0)||evidence.archive_sha256!==manifest.archive_sha256)throw new Error('Package/source integrity check failed');
console.log(JSON.stringify({archive:evidence.archive,sha256:evidence.archive_sha256,runtime_pairs:checks.length,all_match:true}));
