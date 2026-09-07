import type { UserConfig } from 'tsdown'

/**
 * Self-contained tsdown config for the enterprise auth-login bundle.
 *
 * The package lives under "enterprise/" (outside "packages/client/"), so it
 * does NOT use the shared "clientBundle" preset. Like the sidebar-brand bundle,
 * it reproduces the two artifacts the host expects from any browser plugin:
 *   1. `lib/index.js`  — the node half: registers `ctx.authProvider` on the
 *      root context; `BrowserAuth` resolves it lazily on `/login` requests.
 *   2. `lib/client.js` — the browser half: the login-gate UI, wrapped in the
 *      `window.__ModuleLoader__.load({ id, factory })` handoff. Framework and
 *      workspace imports stay external so the runtime module table answers them.
 */
const PKG = '@my-company/auth-login'

// Keep framework / deepseek-ai / sibling enterprise workspace packages external;
// the node host and the browser module table resolve them at runtime.
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
    // The client module system expects each plugin bundle to register itself
    // through the bootstrap queue with exactly this shape.
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PKG)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default [nodeHalf, clientHalf]
