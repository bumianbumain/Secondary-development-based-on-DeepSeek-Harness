import type { UserConfig } from 'tsdown'

/**
 * account-menu Bundle tsdown config：与 auth-login 同型（双半：node + client）。
 *
 * node 半  lib/index.js   注册 /api/biz-user/list 与 /api/biz-user/create HTTP 端点。
 * client 半 lib/client.js 注册 sidebar.footer.action 槽位，渲染账号卡（React）。
 *
 * Framework/deepseek-ai/sibling workspace 包均 external；浏览器模块表与 Node 主机各
 * 自解析。React/JSX 走 alwaysBundle（client 半 cjs 输出 + JSX 改 createElement）。
 */
const PKG = '@my-company/account-menu'

const isExternal = (id: string): boolean =>
  id.startsWith('@deepseek-ai/')
  || id.startsWith('@my-company/')
  || id === 'react'
  || id === 'react-dom'
  || id === 'react-dom/client'
  || id === 'react/jsx-runtime'

const nodeHalf: UserConfig = {
  name: PKG,
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  dts: false,
  clean: false,
  deps: {
    neverBundle: isExternal,
    alwaysBundle: (id: string) => !isExternal(id),
  },
  outputOptions: { entryFileNames: 'index.js' },
}

const clientHalf: UserConfig = {
  name: `${PKG}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: isExternal,
    alwaysBundle: (id: string) => !isExternal(id),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PKG)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default [nodeHalf, clientHalf]
