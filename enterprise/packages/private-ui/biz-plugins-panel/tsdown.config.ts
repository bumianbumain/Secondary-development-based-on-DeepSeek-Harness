import type { UserConfig } from 'tsdown'

/**
 * Self-contained tsdown config for the enterprise business-plugins panel.
 *
 * The package lives under "enterprise/" (outside "packages/client/"), so it does
 * NOT use the shared "clientBundle" preset (that preset hard-codes
 * manifest globs under packages and a repository-relative client base). Instead
 * this config reproduces the two artifacts the host's client-module system
 * expects from any browser plugin:
 *   1. `lib/index.js` — the node half (the Loader entry's `apply`, a no-op here).
 *   2. `lib/client.js` — the browser half, wrapped in the
 *      `window.__ModuleLoader__.load({ id, factory })` handoff the client module
 *      system reads, with every `@deepseek-ai/*` / react import kept external so
 *      the runtime module table (served by the web app) answers them.
 */
const PKG = '@my-company/biz-plugins-panel'

// Keep all framework / deepseek-ai imports external; the browser resolves them
// from the shared module table the web app already serves.
const isExternal = (id: string): boolean =>
  id.startsWith('@deepseek-ai/')
  || id === 'react'
  || id === 'react-dom'
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
