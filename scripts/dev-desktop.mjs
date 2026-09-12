import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({ root, server: { host: '127.0.0.1', open: false } });
await server.listen();
const address = server.httpServer.address();
const devUrl = `http://127.0.0.1:${address.port}`;
console.log(`Electron 开发模式：${devUrl}（F12 打开开发工具）`);

const env = { ...process.env, SANGOTA_DEV_URL: devUrl };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(process.execPath, [
  fileURLToPath(new URL('../node_modules/electron/cli.js', import.meta.url)),
  '.', ...process.argv.slice(2),
], { cwd: root, env, stdio: 'inherit' });

let closing = false;
async function close(code = 0) {
  if (closing) return;
  closing = true;
  child.kill();
  await server.close();
  process.exitCode = code;
}
child.once('exit', (code) => { void close(code ?? 0); });
child.once('error', (error) => {
  console.error(error);
  void close(1);
});
process.once('SIGINT', () => { void close(0); });
process.once('SIGTERM', () => { void close(0); });
