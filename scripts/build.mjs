import {build} from 'esbuild';
import {mkdir, copyFile, access} from 'node:fs/promises';
await mkdir('dist', {recursive:true});
await Promise.all([
  build({entryPoints:['src/main/index.ts'], bundle:true, platform:'node', format:'cjs', target:'node22', external:['electron'], outfile:'dist/main.cjs'}),
  build({entryPoints:['src/main/preload.ts'], bundle:true, platform:'node', format:'cjs', target:'node22', external:['electron'], outfile:'dist/preload.cjs'}),
  build({entryPoints:['src/renderer/main.tsx'], bundle:true, platform:'browser', target:'chrome130', outfile:'dist/renderer.js', define:{'process.env.NODE_ENV':'"production"'}, minify:false}),
  copyFile('src/renderer/index.html','dist/index.html'),
]);
for(const [entry,outfile,platform,external] of [
  ['extensions/browser/src/background.ts','extensions/browser/background.js','browser',[]],
  ['extensions/vscode/src/extension.ts','extensions/vscode/dist/extension.cjs','node',['vscode']],
]) {
  try {await access(entry);} catch {continue;}
  await build({entryPoints:[entry],outfile,bundle:true,platform,format:platform==='node'?'cjs':'iife',target:platform==='node'?'node20':'chrome120',external});
}
