import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { applyDecision, formatDecision, parseDecision, toDecision } from '../src/core/decision.ts';

describe('decisiones (flags --update y --model)', () => {
  test('lee all, none o una lista', () => {
    assert.equal(parseDecision('All'), 'all');
    assert.equal(parseDecision('none'), 'none');
    assert.deepEqual(parseDecision('a, b,,c'), ['a', 'b', 'c']);
  });

  test('lo elegido se escribe como all, none o la lista (en el orden disponible)', () => {
    assert.equal(toDecision(['a', 'b'], ['b', 'a']), 'all');
    assert.equal(toDecision(['a', 'b'], []), 'none');
    assert.deepEqual(toDecision(['a', 'b', 'c'], ['c', 'a']), ['a', 'c']);
    assert.equal(formatDecision(['a', 'c']), 'a,c');
  });

  test('aplicar una decisión avisa lo que ya no está disponible', () => {
    assert.deepEqual(applyDecision(['a', 'b'], 'all'), { chosen: ['a', 'b'], unknown: [] });
    assert.deepEqual(applyDecision(['a', 'b'], 'none'), { chosen: [], unknown: [] });
    assert.deepEqual(applyDecision(['a', 'b'], ['b', 'z']), { chosen: ['b'], unknown: ['z'] });
  });

  test('ida y vuelta: lo que se elige se repite igual', () => {
    const available = ['a', 'b', 'c'];
    for (const chosen of [[], ['b'], ['a', 'c'], available]) {
      assert.deepEqual(applyDecision(available, toDecision(available, chosen)).chosen, chosen);
    }
  });
});
