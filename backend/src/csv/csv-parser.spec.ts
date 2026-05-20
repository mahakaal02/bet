import { parseCsv } from './csv-parser';

describe('parseCsv', () => {
  it('returns empty for empty input', () => {
    expect(parseCsv('')).toEqual({ headers: [], rows: [] });
  });

  it('parses basic comma-separated', () => {
    const r = parseCsv('id,name\n1,alice\n2,bob');
    expect(r.headers).toEqual(['id', 'name']);
    expect(r.rows).toEqual([['1', 'alice'], ['2', 'bob']]);
  });

  it('handles CRLF line terminators', () => {
    const r = parseCsv('id,name\r\n1,alice\r\n2,bob\r\n');
    expect(r.rows).toEqual([['1', 'alice'], ['2', 'bob']]);
  });

  it('handles bare CR line terminators', () => {
    const r = parseCsv('a,b\rc,d');
    expect(r.headers).toEqual(['a', 'b']);
    expect(r.rows).toEqual([['c', 'd']]);
  });

  it('strips UTF-8 BOM', () => {
    const r = parseCsv('﻿id,name\n1,alice');
    expect(r.headers).toEqual(['id', 'name']);
  });

  it('handles quoted comma-containing fields', () => {
    const r = parseCsv('id,description\n1,"hello, world"');
    expect(r.rows[0]).toEqual(['1', 'hello, world']);
  });

  it('handles doubled inner quotes', () => {
    const r = parseCsv('id,text\n1,"she said ""hi"""');
    expect(r.rows[0]).toEqual(['1', 'she said "hi"']);
  });

  it('handles embedded newlines inside quotes', () => {
    const r = parseCsv('id,body\n1,"line 1\nline 2"\n2,short');
    expect(r.rows[0]).toEqual(['1', 'line 1\nline 2']);
    expect(r.rows[1]).toEqual(['2', 'short']);
  });

  it('skips trailing blank lines', () => {
    const r = parseCsv('a,b\n1,2\n\n');
    expect(r.rows).toEqual([['1', '2']]);
  });

  it('preserves empty cells', () => {
    const r = parseCsv('a,b,c\n1,,3');
    expect(r.rows[0]).toEqual(['1', '', '3']);
  });

  it('trims header whitespace', () => {
    const r = parseCsv('  id , name \n1,alice');
    expect(r.headers).toEqual(['id', 'name']);
  });
});
