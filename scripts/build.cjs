// Debug builds retain source maps; packaged builds use the optimized bundle.
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const args = new Set(process.argv.slice(2));
for (const arg of args) {
    if (arg !== '--release' && arg !== '--watch') {
        throw new Error(`Unknown build option: ${arg}`);
    }
}
const release = args.has('--release');
const outfile = path.join(root, 'dist', 'extension.js');
const options = {
    absWorkingDir: root,
    entryPoints: ['src/extension.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['vscode'],
    outfile,
    minify: release,
    sourcemap: !release,
    logLevel: 'info',
};
async function main() {
    if (release) {
        fs.rmSync(outfile + '.map', { force: true });
    }
    console.log(`Building R^ extension (${release ? 'Release' : 'Debug'})`);
    if (args.has('--watch')) {
        const context = await esbuild.context(options);
        await context.watch();
    } else {
        await esbuild.build(options);
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
