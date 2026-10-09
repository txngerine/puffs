// Runs the API and the Vite dev server together; Ctrl+C stops both.
import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const procs = [['server', '\x1b[90m'], ['client', '\x1b[37m']].map(([name, color]) => {
  const p = spawn(npm, ['run', 'dev', '-w', name], { stdio: ['inherit', 'pipe', 'pipe'], shell: process.platform === 'win32' });
  const tag = `${color}[${name}]\x1b[0m `;
  const pipe = (src, dst) => src.on('data', (d) => dst.write(d.toString().replace(/^(?=.)/gm, tag)));
  pipe(p.stdout, process.stdout);
  pipe(p.stderr, process.stderr);
  p.on('exit', (code) => { console.log(`${tag}exited (${code})`); stop(); });
  return p;
});
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  procs.forEach((p) => p.exitCode === null && p.kill('SIGINT'));
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
