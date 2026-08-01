/**
 * 手写的三行 fs 声明，代替 @types/node：tsconfig 的 `types: ["vite/client"]`
 * 把 node 的环境声明整个挡在编译之外，而放它进来是给全项目（含 src/ 的游戏
 * 代码）换类型环境——为了 `evaluate.sim.ts` 一个只在 vitest 里跑的报告落盘，
 * 不值得。运行时解析到的是真的 node:fs；这里只声明用到的三个函数，谁想在
 * src/ 里偷用 fs，缺的类型会先拦住他。
 *
 * 必须是独立的 .d.ts：在模块文件里 `declare module` 是对已有模块的增补，
 * 模块本身解析不到时是 TS2664；只有非模块上下文允许凭空声明一个模块。
 */
declare module 'node:fs' {
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, opts?: { recursive?: boolean }): void;
  export function writeFileSync(path: string, data: string): void;
}
