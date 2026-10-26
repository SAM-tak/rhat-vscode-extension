const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { test } = require('node:test');
const { expandSetting, resolveServer, isRhatSource } = require('../out/server');

function fixture(t) {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'rhat-extension-paths-'));
    t.after(() => {
        assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
        assert(path.basename(temporary).startsWith('rhat-extension-paths-'));
        fs.rmSync(temporary, { recursive: true, force: true });
    });
    const extensionPath = path.join(temporary, 'rhat-vscode-extension');
    fs.mkdirSync(extensionPath);
    return { extensionPath, development: false, folders: [{ name: 'project', path: temporary }], environment: { TOOL_ROOT: temporary } };
}
const settings = (extra = {}) => ({ serverPath: '', stdlibPath: '', modulePaths: [], autoRestart: true, ...extra });
const executable = process.platform === 'win32' ? 'rhatls.exe' : 'rhatls';
function file(at) { fs.mkdirSync(path.dirname(at), { recursive: true }); fs.writeFileSync(at, 'test executable'); fs.chmodSync(at, 0o755); return at; }

test('server discovery honors explicit, bundled, development and PATH precedence', t => {
    const context = fixture(t);
    assert.equal(resolveServer(settings(), context).source, 'path');
    const development = file(path.join(context.extensionPath, '..', 'rhat', 'build', 'Debug', executable));
    assert.equal(resolveServer(settings(), context).source, 'path', 'production must not use sibling source checkouts');
    context.development = true;
    assert.equal(resolveServer(settings(), context).command, path.normalize(development));
    const bundled = file(path.join(context.extensionPath, 'bin', executable));
    assert.equal(resolveServer(settings(), context).command, bundled);
    const explicit = file(path.join(context.folders[0].path, 'tools with spaces', executable));
    assert.equal(resolveServer(settings({ serverPath: explicit }), context).command, explicit);
    assert.equal(resolveServer(settings({ serverPath: 'custom-rhatls' }), context).command, 'custom-rhatls');
});

test('invalid configured binaries fail instead of silently selecting a different server', t => {
    const context = fixture(t);
    file(path.join(context.extensionPath, 'bin', executable));
    assert.throws(() => resolveServer(settings({ serverPath: './missing/server.exe' }), context), /ENOENT/);
    assert.throws(() => resolveServer(settings({ serverPath: context.extensionPath }), context), /Not a language-server executable/);
});

test('module and stdlib paths use structured arguments and expand workspace and environment variables', t => {
    const context = fixture(t);
    const launch = resolveServer(settings({ modulePaths: ['modules', '${workspaceFolder}/modules', '${env:TOOL_ROOT}/other'], stdlibPath: '${workspaceFolder:project}/standard library' }), context);
    assert.deepEqual(launch.modulePaths, [path.join(context.folders[0].path, 'modules'), path.join(context.folders[0].path, 'other')]);
    assert.deepEqual(launch.args, ['--stdio', '--stdlib', path.join(context.folders[0].path, 'standard library')]);
    assert.equal(launch.cwd, context.folders[0].path);
    assert.equal(expandSetting('$(uninterpreted)', context), '$(uninterpreted)');
    assert.equal(expandSetting('~/tools', context), path.join(os.homedir(), 'tools'));
    assert.throws(() => expandSetting('${env:MISSING}', context), /is not set/);
    assert.throws(() => expandSetting('${workspaceFolder:missing}', context), /matching workspace folder/);
    assert.throws(() => expandSetting('${command:anything}', context), /Unsupported path variable/);
});

test('loose files use their directory and unresolved relative directories fail clearly', t => {
    const context = fixture(t);
    context.folders = [];
    context.baseDirectory = context.extensionPath;
    assert.deepEqual(resolveServer(settings({ modulePaths: ['lib'] }), context).modulePaths, [path.join(context.extensionPath, 'lib')]);
    delete context.baseDirectory;
    assert.throws(() => resolveServer(settings({ modulePaths: ['lib'] }), context), /Use an absolute path/);
    assert.throws(() => resolveServer(settings({ modulePaths: [''] }), context), /must not be empty/);
});

test('source watching skips caches and dependencies but includes ordinary source modules', () => {
    for (const name of ['src/example.rh', 'lib/日本語.rh', 'build/module.rh']) { assert(isRhatSource(name), name); }
    for (const name of ['source.cpp', '.git/generated.rh', 'node_modules/lib/file.rh', 'a/.rhat-cache/generated.rh']) { assert(!isRhatSource(name), name); }
});
