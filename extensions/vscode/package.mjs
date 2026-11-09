import {mkdir, realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {build} from 'esbuild';

const directory = path.dirname(fileURLToPath(import.meta.url));
const output = path.resolve(directory, '../../release/context-first-vscode-0.1.0.vsix');
await build({entryPoints: [path.join(directory, 'src/extension.ts')], bundle: true, outfile: path.join(directory, 'dist/extension.cjs'), platform: 'node', format: 'cjs', target: 'node20', external: ['vscode']});
await mkdir(path.dirname(output), {recursive: true});
const candidates = [process.env.npm_execpath, path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), '/usr/bin/npm', '/usr/local/bin/npm'].filter(Boolean);
let npmCli;
for (const candidate of candidates) {
  try {npmCli = await realpath(candidate); break;} catch {}
}
if (!npmCli) throw new Error('npm is required to package the VS Code extension.');
const child = spawn(process.execPath, [npmCli, 'exec', '--yes', '--package=@vscode/vsce@4.1.0', '--', 'vsce', 'package', '--no-dependencies', '--skip-license', '--allow-missing-repository', '--out', output], {cwd: directory, stdio: 'inherit', windowsHide: true});
const exitCode = await new Promise((resolve, reject) => {child.on('error', reject); child.on('exit', resolve);});
if (exitCode !== 0) process.exit(exitCode ?? 1);
console.log(output);
