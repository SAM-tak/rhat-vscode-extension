const assert = require('node:assert/strict');
const { test } = require('node:test');
const config = require('../language-configuration.json');

const increase = new RegExp(config.indentationRules.increaseIndentPattern);
const decrease = new RegExp(config.indentationRules.decreaseIndentPattern);
const clause = new RegExp(config.onEnterRules[0].beforeText);

test('lines opening a bracket or ending a clause head indent the next line', () => {
    for (const line of [
        'let^show = p^r:i64^ | E.Bad {',
        '    if^r fits^i64^{',
        '    let^v = if^n > 0:',
        '    return^read(n) catch^for^it^:',
        '        when^fits^E.Bad:',
        '    elseif^r fits^t.Error.Invalid:',
        '    else^:',
        '    print^(',
        '    let^xs = [',
        'def^P {  # trailing comment',
    ]) {
        assert.ok(increase.test(line), line);
    }
    for (const line of [
        '    print^(r)',
        '    self^{ x:i64^ }',
        '    return^E.Bad{}',
        '    1;',
        '    let^x = 1  # note:',
        '    }',
    ]) {
        assert.ok(!increase.test(line), line);
    }
});

test('closing brackets and statement clause labels return to the head', () => {
    for (const line of ['}', '    })', '    ]', '    elseif^r fits^E.Bad:', '    else^:', '        other^:']) {
        assert.ok(decrease.test(line), line);
    }
    for (const line of ['    el^:', '        when^fits^E.Bad:', '    elsewhere^ = 1', '    otherwise = 2', '    print^(1)']) {
        assert.ok(!decrease.test(line), line);
    }
});

test('enter after a clause label indents its body', () => {
    for (const line of ['    else^:', '    el^:', '        when^fits^E.Bad:', '    other^:  # rest', '    catch^E.Bad:']) {
        assert.ok(clause.test(line), line);
    }
    assert.ok(!clause.test('    let^x = y catch^ 0'));
});
