import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import localtunnel from 'localtunnel';

const port = Number(process.env.PORT || 3000);
const server = fork(path.join(path.dirname(fileURLToPath(import.meta.url)), 'server.js'), [], {
  stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
  env: { ...process.env, PORT: String(port) },
});
let tunnel;
let stopping = false;

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) throw new Error('本地服务未能启动。');
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('等待本地服务启动超时。');
}

async function stop() {
  if (stopping) return;
  stopping = true;
  if (tunnel) await tunnel.close();
  server.kill('SIGTERM');
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, stop);
server.on('exit', (code) => {
  if (!stopping) process.exitCode = code || 0;
});

try {
  await waitForServer();
  tunnel = await localtunnel({ port, local_host: '127.0.0.1' });
  server.send({ type: 'public-url', url: tunnel.url });
  console.log(`\n发给异地朋友的联机地址：${tunnel.url}`);
  console.log('把这个地址和房间码发给朋友；关闭此窗口后链接失效。\n');
  tunnel.on('close', () => {
    if (!stopping) {
      console.error('公网隧道已断开。');
      stop();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('exit', resolve);
    server.once('error', reject);
  });
} catch (error) {
  console.error(`公网入口建立失败：${error.message}`);
  console.error('请检查网络连接后重试；普通 npm start 只允许本机或局域网访问。');
  await stop();
  process.exitCode = 1;
}
