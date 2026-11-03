// Exercise the same native launch options over the client's JSON-RPC transport.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { once } = require('node:events');
const { createMessageConnection, StreamMessageReader, StreamMessageWriter } = require('vscode-languageserver-protocol/node');
const { resolveServer } = require('../out/server');

async function main() {
    const root = path.resolve(__dirname, '..');
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'rhat-vscode-smoke-'));
    const serverFlag = process.argv.indexOf('--server');
    if (process.argv.length > 2 && (serverFlag !== 2 || !process.argv[3] || process.argv.length !== 4)) {
        throw new Error('Usage: npm run test:server -- [--server PATH]');
    }
    const launch = resolveServer({ serverPath: serverFlag >= 0 ? path.resolve(process.argv[serverFlag+1]) : '', modulePaths: [], stdlibPath: '', autoRestart: false }, {
        extensionPath: root, development: true, folders: [{ name: 'smoke', path: workspace }],
    });
    const child = spawn(launch.command, launch.args, { cwd: launch.cwd, windowsHide: true, shell: false });
    const exited = once(child, 'exit');
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    const connection = createMessageConnection(new StreamMessageReader(child.stdout), new StreamMessageWriter(child.stdin));
    const diagnostics = [], waiters = [];
    connection.onNotification('textDocument/publishDiagnostics', params => {
        diagnostics.push(params);
        for (const wake of [...waiters]) { wake(); }
    });
    function diagnosticWhere(predicate) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { cleanup(); reject(new Error('Timed out waiting for diagnostics: '+stderr)); }, 15000);
            const wake = () => {
                const found = diagnostics.find(predicate);
                if (found) { cleanup(); resolve(found.diagnostics); }
            };
            function cleanup() { clearTimeout(timer); const n = waiters.indexOf(wake); if (n >= 0) { waiters.splice(n, 1); } }
            waiters.push(wake); wake();
        });
    }
    const checked = version => diagnosticWhere(d => d.version === version);
    let initialized = false;
    const watchdog = setTimeout(() => { child.kill(); }, 30000);
    try {
        connection.listen();
        const uri = pathToFileURL(path.join(workspace, 'unsaved 日本語.rh')).href;
        fs.mkdirSync(path.join(workspace, 'lib'));
        fs.writeFileSync(path.join(workspace, '.editorconfig'), 'root=true\n[*.rh]\nend_of_line=lf\n');
        fs.writeFileSync(path.join(workspace, 'lib', 'math.rh'), 'module^ lib.math\npublic^ let^ twice=f^ x:i64^ ->i64^ {x*2}\n');
        const capabilities = await connection.sendRequest('initialize', {
            processId: process.pid, rootUri: pathToFileURL(workspace).href,
            workspaceFolders: [{ uri: pathToFileURL(workspace).href, name: 'smoke' }],
            capabilities: { general: { positionEncodings: ['utf-16'] } },
            initializationOptions: { modulePaths: launch.modulePaths },
        });
        assert.equal(capabilities.serverInfo.name, 'rhat');
        assert.equal(capabilities.capabilities.documentFormattingProvider, true);
        initialized = true;
        await connection.sendNotification('initialized', {});
        const content = 'let^ math=import^ lib.math\nprint^("😀",math.twice(21))\n';
        await connection.sendNotification('textDocument/didOpen', { textDocument: { uri, languageId: 'rhat', version: 1, text: content } });
        assert.deepEqual(await checked(1), []);
        const edits = await connection.sendRequest('textDocument/formatting', {
            textDocument: { uri }, options: { tabSize: 4, insertSpaces: true },
        });
        assert.equal(edits.length, 1);
        assert.equal(edits[0].newText, 'let^math = import^lib.math\nprint^("😀", math.twice(21))\n');
        assert.deepEqual(edits[0].range, { start: { line: 0, character: 0 }, end: { line: 2, character: 0 } });
        assert.equal(fs.existsSync(path.join(workspace, 'unsaved 日本語.rh')), false);
        const position = { line: 1, character: 'print^("😀",math.'.length };
        const hover = await connection.sendRequest('textDocument/hover', { textDocument: { uri }, position });
        assert.match(hover.contents.value, /twice : f\^x:i64\^ -> i64\^/);
        const definition = await connection.sendRequest('textDocument/definition', { textDocument: { uri }, position });
        assert.equal(definition.uri.toLowerCase(), pathToFileURL(path.join(workspace, 'lib', 'math.rh')).href.toLowerCase());
        await connection.sendNotification('textDocument/didChange', { textDocument: { uri, version: 2 }, contentChanges: [{ text: content.replace('21', '"bad"') }] });
        await checked(2);
        assert((await diagnosticWhere(d => d.diagnostics.length > 0)).length > 0);
        await connection.sendNotification('textDocument/didChange', { textDocument: { uri, version: 3 }, contentChanges: [{ text: content }] });
        assert.deepEqual(await checked(3), []);
        await connection.sendNotification('textDocument/didClose', { textDocument: { uri } });
        await connection.sendRequest('shutdown'); initialized = false;
        await connection.sendNotification('exit');
        const [code] = await exited;
        assert.equal(code, 0); assert.equal(stderr, '');
        console.log('PASS native rhat lsp: discovery, formatting, unsaved edits, UTF-16 hover, cross-module definition and shutdown');
    } finally {
        clearTimeout(watchdog);
        if (initialized) { child.kill(); }
        if (child.exitCode === null && child.signalCode === null) { child.kill(); }
        connection.dispose();
        assert.equal(path.dirname(path.resolve(workspace)), path.resolve(os.tmpdir()));
        assert(path.basename(workspace).startsWith('rhat-vscode-smoke-'));
        fs.rmSync(workspace, { recursive: true, force: true });
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
