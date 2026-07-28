import { describe, expect, it } from 'vitest';
import { escapeIlike } from '../src/middleware/validate';

describe('escapeIlike', () => {
  it('escapes wildcard characters so a query of % cannot match everything', () => {
    expect(escapeIlike('%')).toBe('\\%');
    expect(escapeIlike('_foo_')).toBe('\\_foo\\_');
    expect(escapeIlike('a\\b%c')).toBe('a\\\\b\\%c');
  });
});
