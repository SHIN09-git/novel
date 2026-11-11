import { build } from 'esbuild'
import { repoRoot } from './repo-root.mjs'

// Compile the production module graph rather than a hand-maintained list of transitive imports.
export async function loadDomainModules(...entries) {
  const { outputFiles } = await build({
    stdin: { resolveDir: repoRoot, contents: entries.map(e => 'export * from ' + JSON.stringify('./src/' + e)).join('\n') },
    bundle: true, write: false, platform: 'node', format: 'esm', target: 'node22'
  })
  return import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].contents).toString('base64'))
}
