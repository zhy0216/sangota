const [sceneName, ...viteArgs] = Bun.argv.slice(2);

if (!sceneName) {
  console.error('用法: bun run dev:scene <场景名> [Vite 参数]');
  console.error('示例: bun run dev:scene scene1');
  process.exit(1);
}

const scenePath = `${import.meta.dir}/../src/devScenes/scenes/${sceneName}.ts`;
if (!(await Bun.file(scenePath).exists())) {
  console.error(`找不到测试场景: src/devScenes/scenes/${sceneName}.ts`);
  process.exit(1);
}

console.log(`启动测试场景: ${sceneName}`);
const child = Bun.spawn(['bun', 'run', 'dev', ...viteArgs], {
  cwd: `${import.meta.dir}/..`,
  env: { ...process.env, VITE_DEV_SCENE: sceneName },
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
});

process.exit(await child.exited);
