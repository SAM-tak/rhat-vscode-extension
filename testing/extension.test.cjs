const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');

function event() {
    const listeners = new Set();
    return { subscribe: callback => { listeners.add(callback); return { dispose: () => listeners.delete(callback) }; }, fire: value => { for (const callback of listeners) { callback(value); } } };
}
function harness() {
    const settings = { serverPath: 'test-rhat', stdlibPath: '', modulePaths: ['lib'], serverAutoRestart: true };
    const configuration = event(), folders = event(), trust = event();
    const commands = new Map(), instances = [], watchers = [], notices = [], messages = [];
    const uri = file => ({ fsPath: file, scheme: 'file', toString: () => pathToFileURL(file).href });
    const workspace = path.resolve(__dirname, 'workspace');
    const output = { info: value => messages.push(value), error: value => messages.push(value), debug: value => messages.push(value), show() {}, dispose() {} };
    const vscode = {
        ExtensionMode: { Production: 1, Development: 2, Test: 3 },
        RelativePattern: class { constructor(base, pattern) { this.base = base; this.pattern = pattern; } },
        workspace: {
            isTrusted: true,
            workspaceFolders: [{ name: 'workspace', uri: uri(workspace) }],
            getConfiguration: () => ({ get: (key, fallback) => settings[key] ?? fallback }),
            onDidChangeConfiguration: configuration.subscribe,
            onDidChangeWorkspaceFolders: folders.subscribe,
            onDidGrantWorkspaceTrust: trust.subscribe,
            onDidChangeTextDocument: event().subscribe,
            createFileSystemWatcher: pattern => {
                const create = event(), change = event(), remove = event();
                const watcher = { pattern, create, change, remove, disposed: false, onDidCreate: create.subscribe, onDidChange: change.subscribe, onDidDelete: remove.subscribe, dispose() { this.disposed = true; } };
                watchers.push(watcher); return watcher;
            },
        },
        window: {
            visibleTextEditors: [],
            createTextEditorDecorationType: () => ({ dispose() {} }),
            onDidChangeVisibleTextEditors: event().subscribe,
            createOutputChannel: () => output,
            showErrorMessage: message => { notices.push(message); return new Promise(() => {}); },
        },
        commands: {
            registerCommand: (name, action) => { commands.set(name, action); return { dispose: () => commands.delete(name) }; },
            executeCommand: async () => undefined,
        },
    };
    let active = 0, failStart = false;
    class Client {
        constructor(id, name, server, options) { Object.assign(this, { id, name, server, options, running: false, notifications: [] }); instances.push(this); }
        async start() { if (failStart) { throw new Error('test launch failure'); } this.running = true; active++; assert.equal(active, 1, 'native server lifetimes must not overlap'); }
        async dispose() { if (this.running) { active--; } this.running = false; this.disposed = true; }
        isRunning() { return this.running; }
        async sendNotification(method, params) { this.notifications.push({ method, params }); }
    }
    const previous = Module._load;
    const entry = require.resolve('../out/extension');
    delete require.cache[entry];
    Module._load = function(id, parent, main) {
        if (id === 'vscode') { return vscode; }
        if (id === 'vscode-languageclient/node') { return { LanguageClient: Client, CloseAction: { DoNotRestart: 1 }, ErrorAction: { Continue: 1 } }; }
        return previous.call(this, id, parent, main);
    };
    let extension;
    try { extension = require(entry); } finally { Module._load = previous; }
    const context = { extensionPath: path.resolve(__dirname, '..'), extensionMode: 1, subscriptions: [] };
    return { settings, configuration, folders, trust, vscode, commands, instances, watchers, notices, messages, uri, workspace, context, extension, setFail: () => { failStart = true; } };
}

test('the VS Code adapter configures stdio, forwards source changes and serializes restarts', async () => {
    const h = harness();
    try {
        await h.extension.activate(h.context);
        assert.equal(h.instances.length, 1);
        const client = h.instances[0];
        assert.equal(client.server.command, 'test-rhat');
        assert.deepEqual(client.server.args, ['lsp', '--stdio']);
        assert.equal(client.server.options.shell, false);
        assert.deepEqual(client.options.documentSelector, [{ scheme: 'file', language: 'rhat' }]);
        assert.deepEqual(client.options.initializationOptions.modulePaths, [path.join(h.workspace, 'lib')]);
        h.watchers[0].change.fire(h.uri(path.join(h.workspace, 'module.rh')));
        h.watchers[0].change.fire(h.uri(path.join(h.workspace, '.rhat-cache', 'cached.rh')));
        assert.equal(client.notifications.length, 1);
        assert.equal(client.notifications[0].method, 'workspace/didChangeWatchedFiles');
        await Promise.all([h.commands.get('rhat.restartServer')(), h.commands.get('rhat.restartServer')()]);
        assert.equal(h.instances.length, 2);
        assert(client.disposed);
        h.settings.serverAutoRestart = false;
        h.configuration.fire({ affectsConfiguration: name => name === 'rhat' });
        await h.commands.get('rhat.restartServer')();
        assert.equal(h.instances.at(-1).options.errorHandler.closed().action, 1);
        await h.commands.get('rhat.stopServer')();
        assert(h.instances.every(item => !item.running));
        assert(h.watchers.every(item => item.disposed));
        assert.equal(h.notices.length, 0);
    } finally {
        await h.extension.deactivate(); h.context.subscriptions.forEach(item => item.dispose());
    }
});

test('restricted workspaces keep syntax support and start the server only after trust is granted', async () => {
    const h = harness(); h.vscode.workspace.isTrusted = false;
    try {
        await h.extension.activate(h.context);
        assert.equal(h.instances.length, 0);
        assert(h.commands.has('rhat.restartServer'));
        h.vscode.workspace.isTrusted = true; h.trust.fire();
        await h.commands.get('rhat.restartServer')();
        assert.equal(h.instances.length, 1);
    } finally {
        await h.extension.deactivate(); h.context.subscriptions.forEach(item => item.dispose());
    }
});

test('startup failure preserves commands and does not block activation on an error popup', async () => {
    const h = harness(); h.setFail();
    try {
        await h.extension.activate(h.context);
        assert.equal(h.notices.length, 1);
        assert.match(h.notices[0], /test launch failure/);
        assert(h.commands.has('rhat.restartServer'));
        assert(h.instances[0].disposed);
    } finally {
        await h.extension.deactivate(); h.context.subscriptions.forEach(item => item.dispose());
    }
});
