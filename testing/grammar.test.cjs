const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { Registry, parseRawGrammar } = require('vscode-textmate');
const { loadWASM, OnigScanner, OnigString } = require('vscode-oniguruma');
const filename = path.resolve(__dirname, '../syntaxes/rhat.tmLanguage.json');
const grammar = (async () => {
    await loadWASM(fs.readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm')));
    const registry = new Registry({
        onigLib: Promise.resolve({ createOnigScanner: p => new OnigScanner(p), createOnigString: s => new OnigString(s) }),
        loadGrammar: async scope => scope === 'source.rhat' ? parseRawGrammar(fs.readFileSync(filename, 'utf8'), filename) : null,
    });
    return registry.loadGrammar('source.rhat');
})();
async function tokens(source) {
    const g = await grammar;
    let state;
    const result = [];
    for (const line of source.split('\n')) {
        const next = g.tokenizeLine(line, state);
        result.push(...next.tokens.map(t => ({ text: line.slice(t.startIndex, t.endIndex), scopes: t.scopes })));
        state = next.ruleStack;
    }
    return result;
}
const scoped = (tokens, scope) => tokens.filter(t => t.scopes.includes(scope)).map(t => t.text);

test('cross and dot aliases retain operator scopes with or without whitespace', async () => {
    for (const source of ['n.delta×(p-n.origin) 左⋅右', 'n.delta × (p-n.origin) 左 ⋅ 右']) {
        const result = await tokens(source);
        assert.deepEqual(scoped(result, 'keyword.operator.word.rhat'), ['×', '⋅']);
        assert.deepEqual(scoped(result, 'entity.name.function.rhat'), []);
    }
    const result = await tokens('cross^ dot^ op^× op^⋅ "× ⋅" `×`');
    assert.deepEqual(scoped(result, 'keyword.operator.word.rhat'), ['cross', 'dot', '×', '⋅']);
});

test('R^ color defaults emphasize operators and hats use configurable opacity decorations', () => {
    const pkg = require('../package.json');
    const rules = pkg.contributes.configurationDefaults['editor.tokenColorCustomizations'].textMateRules;
    const settings = scope => rules.find(rule => [rule.scope].flat().includes(scope))?.settings;
    assert.equal(settings('punctuation.definition.hat.rhat'), undefined);
    assert.equal(pkg.contributes.configuration.properties['rhat.hatOpacity'].default, 0.5);
    assert.deepEqual(settings('keyword.operator.word.rhat'), { foreground: '#569BD2' });
    for (const scope of ['keyword.operator.assignment.compound.rhat', 'keyword.operator.nil-assignment.rhat']) {
        assert.deepEqual(settings(scope), { foreground: '#D7BA7D', fontStyle: 'bold' });
    }
});

test('section names and unknown hat words use the same scope categories as L^', async () => {
    const result = await tokens('prolog^ main^ epilog^ custom^ fits^ i64^');
    assert.deepEqual(scoped(result, 'support.function.rhat'), ['prolog', 'main', 'epilog']);
    assert.deepEqual(scoped(result, 'keyword.other.rhat'), ['custom']);
    assert.deepEqual(scoped(result, 'punctuation.definition.hat.rhat'), Array(6).fill('^'));
});

test('fixed-width built-in types require a hat; ordinary bool/i64 remain identifiers', async () => {
    const names = ['bool','u8','u16','u32','u64','u128','i8','i16','i32','i64','i128','f8','f16','f32','f64','string','nil'];
    assert.deepEqual(scoped(await tokens(names.map(x => x+'^').join(' ')), 'storage.type.rhat'), names);
    assert.deepEqual(scoped(await tokens(names.join(' ')), 'storage.type.rhat'), []);
    assert.deepEqual(scoped(await tokens('私i64^ i64^^'), 'storage.type.rhat'), []);
});

test('clauses, template literals, outer receivers and lexical selectors use R^ syntax', async () => {
    const result = await tokens('let^fn=template^f^ self^ { if^ true^ { return^ this^^() else^: return^ $^local } }');
    assert.deepEqual(scoped(result, 'keyword.control.rhat'), ['if','return','else','return']);
    assert(scoped(result, 'keyword.other.declaration.rhat').includes('template'));
    assert(scoped(result, 'variable.language.rhat').includes('this'));
    assert.deepEqual(scoped(result, 'variable.language.scope.rhat'), ['$^local']);
});

test('L^-only constructs are not advertised as R^ keywords or types', async () => {
    const result = await tokens('require^ pack^ number^ any^ t^ error^ as^ yield^');
    assert.deepEqual(scoped(result, 'storage.type.rhat'), []);
    assert.deepEqual(scoped(result, 'keyword.other.declaration.rhat'), []);
    assert.deepEqual(scoped(result, 'keyword.control.rhat'), []);
    assert.deepEqual(scoped(result, 'keyword.operator.word.rhat'), []);
});

test('nominal structs and errors keep declaration names distinct from fields', async () => {
    const result = await tokens('def^ Point {self^{value:i64^}} errordef^ Error {Bad} enum^ Mode {A}');
    assert.deepEqual(scoped(result, 'entity.name.type.rhat'), ['Point','Error','Mode']);
    assert.deepEqual(scoped(result, 'storage.type.rhat'), ['i64']);
});

test('hats separate declaration words and names without requiring spaces', async () => {
    const scopes = result => result.filter(t => t.text.trim()).map(t => ({
        text: t.text.trim(), scopes: t.scopes,
    }));
    for (const [compact, spaced] of [
        ['let^name=1', 'let^ name=1'],
        ['def^Point {self^{x:i64^}}', 'def^ Point {self^{x:i64^}}'],
        ['errordef^Error {Bad}', 'errordef^ Error {Bad}'],
        ['enum^Mode {A}', 'enum^ Mode {A}'],
        ['public^def^Point {}', 'public^ def^ Point {}'],
        ['let^run=template^f^x {return^x}', 'let^ run=template^ f^ x {return^ x}'],
    ]) {
        assert.deepEqual(scopes(await tokens(compact)), scopes(await tokens(spaced)), compact);
    }
});

test('nested comments span lines and do not leak keywords into source scopes', async () => {
    const result = await tokens('#[ outer\n#[ if^ i64^ ]#\n]#\nlet^x=1 # i64^');
    assert.deepEqual(scoped(result, 'storage.type.rhat'), []);
    assert(scoped(result,'comment.block.rhat').some(x => x.includes('if^')));
    assert.deepEqual(scoped(result, 'keyword.other.declaration.rhat'), ['let']);
});

test('escaped, raw, line strings and quoted identifiers retain their own lexical rules', async () => {
    const result = await tokens('"a\\n" \'it\'\'s\' `column name`\n"""raw\\q\nlet^ x=1');
    assert(scoped(result, 'constant.character.escape.rhat').includes('\\n'));
    assert(scoped(result, 'constant.character.escape.rhat').includes("''"));
    assert(scoped(result, 'variable.other.name-literal.rhat').some(x => x.includes('column name')));
    assert.deepEqual(scoped(result, 'invalid.illegal.escape.rhat'), []);
    assert.deepEqual(scoped(result, 'keyword.other.declaration.rhat'), ['let']);
    assert.deepEqual(scoped(await tokens('"\\q"'), 'invalid.illegal.escape.rhat'), ['\\q']);
});

test('numbers, array ranges, references and nil propagation do not inherit table operators', async () => {
    const result = await tokens('0xff 0b10 0o7 1_000 1.25e-3 i64^[>..] &value a?.x a?[0] a??0 a?:=1 a?+=2 a+=3');
    assert.deepEqual(scoped(result, 'constant.numeric.float.rhat'), ['1.25e-3']);
    assert.deepEqual(scoped(result, 'keyword.operator.reference.rhat'), ['&']);
    assert.deepEqual(scoped(result, 'keyword.operator.range.rhat'), ['..']);
    assert.deepEqual(scoped(result, 'keyword.operator.nil-assignment.rhat'), ['?:=','?+=']);
    assert.deepEqual(scoped(result, 'keyword.operator.assignment.compound.rhat'), ['+=']);
    assert.deepEqual(scoped(result, 'keyword.operator.nil-propagation.rhat'), ['?.','?[']);
});

test('array kinds and element reference modifiers stay inside brackets', async () => {
    const result = await tokens('Node[grow^] Node[flex^] Node[..] Node[ref^max^10] ref^Node[ref^grow^] Node[ref^ ..]');
    assert.deepEqual(scoped(result, 'storage.modifier.array.rhat'), ['grow','flex','max','grow']);
    assert.deepEqual(scoped(result, 'keyword.other.rhat'), ['ref','ref','ref','ref']);
    assert.deepEqual(scoped(result, 'keyword.operator.range.rhat'), ['..','..']);
});

test('array literals are braces after an optional array type', async () => {
    const result = await tokens('Node[ref^max^10]{a[0], ref^a[1]} u32^[max^10]{0,1} {1, 2} i32^[](n, 0)');
    assert.deepEqual(scoped(result, 'storage.modifier.array.rhat'), ['max','max']);
    assert.deepEqual(scoped(result, 'punctuation.separator.rhat').filter(x => x === ';'), []);
    assert(scoped(result, 'storage.type.rhat').includes('u32'));
});
