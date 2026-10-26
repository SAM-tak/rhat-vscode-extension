// Preserve the licenses of production packages included in the bundled client.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const notices = new Map();
function findPackage(name, from) {
    for (let at = from;; at = path.dirname(at)) {
        const candidate = path.join(at, 'node_modules', name);
        if (fs.existsSync(path.join(candidate, 'package.json'))) { return candidate; }
        if (path.dirname(at) === at) { throw new Error(`Cannot find runtime dependency ${name}`); }
    }
}
function visit(directory) {
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
    for (const name of Object.keys(manifest.dependencies ?? {})) {
        const location = findPackage(name, directory);
        const info = JSON.parse(fs.readFileSync(path.join(location, 'package.json'), 'utf8'));
        const id = `${info.name}@${info.version}`;
        if (notices.has(id)) { continue; }
        const files = fs.readdirSync(location).filter(file => /^(?:licen[cs]e|copying)(?:[.-].*)?$/i.test(file));
        if (!files.length) { throw new Error(`Review and include the license for ${id}`); }
        const license = files.map(file => fs.readFileSync(path.join(location, file), 'utf8').trim()).join('\n\n');
        notices.set(id, `## ${id}\n\n${info.license ?? ''}\n\n\u0060\u0060\u0060text\n${license}\n\u0060\u0060\u0060\n`);
        visit(location);
    }
}
visit(root);
fs.writeFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), '# Third-party notices\n\nThe bundled language client includes the following runtime dependencies.\n\n' + [...notices.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([,notice]) => notice).join('\n'));
console.log(`Recorded licenses for ${notices.size} runtime dependencies.`);
