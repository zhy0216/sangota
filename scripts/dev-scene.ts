const args = Bun.argv.slice(2);
const sceneName = args[0] && !args[0].startsWith('-') ? args[0] : '';
const viteArgs = sceneName ? args.slice(1) : args;

if (sceneName) {
  const scenePath = `${import.meta.dir}/../src/devScenes/scenes/${sceneName}.ts`;
  if (!(await Bun.file(scenePath).exists())) {
    console.error(`找不到测试场景: src/devScenes/scenes/${sceneName}.ts`);
    process.exit(1);
  }
}

const requested = sceneName || '__menu__';
console.log(sceneName ? `启动测试场景: ${sceneName}` : '启动测试场景选择页');
const child = Bun.spawn(['bun', 'run', 'dev', ...viteArgs], {
  cwd: `${import.meta.dir}/..`,
  env: { ...process.env, VITE_DEV_SCENE: requested },
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
});

process.exit(await child.exited);
