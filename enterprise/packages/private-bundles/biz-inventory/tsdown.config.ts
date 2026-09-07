// 临时 tsdown 配置（业务 Bundle 单 node 半；复用 auth-login 的结构）
import type { UserConfig } from 'tsdown'

const PKG = '@my-company/biz-inventory'
const isExternal = (id: string): boolean =>
  id.startsWith('@deepseek-ai/') || id.startsWith('@my-company/') || id === 'mssql'

const nodeHalf: UserConfig = {
  name: PKG,
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  dts: false,
  clean: false,
  deps: { neverBundle: isExternal, alwaysBundle: (id) => !isExternal(id) },
  outputOptions: { entryFileNames: 'index.js' },
}

export default [nodeHalf]
