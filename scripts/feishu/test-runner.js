#!/usr/bin/env node
/**
 * Test runner for feishu CLI
 * Note: Uses execFileSync for CLI integration tests (controlled input, not user-facing)
 */
const { parseUrl, extractTableId, isUrl, smartParse } = require('./lib/parser');
const { execFileSync } = require('child_process');
const path = require('path');

let passed = 0;
let failed = 0;

function section(name) {
  console.log(`\n${name}`);
  console.log('─'.repeat(name.length));
}

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${error.message}`);
  }
}

function expect(actual) {
  return {
    toBe(expected) {
      if (actual !== expected) {
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    },
    toEqual(expected) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    },
    toBeNull() {
      if (actual !== null) {
        throw new Error(`Expected null, got ${JSON.stringify(actual)}`);
      }
    },
    toContain(expected) {
      if (!actual.includes(expected)) {
        throw new Error(`Expected "${actual.slice(0, 100)}..." to contain "${expected}"`);
      }
    },
  };
}

// CLI helper using execFileSync (safe, no shell injection)
const cliPath = path.join(__dirname, 'index.js');
function runCli(args) {
  try {
    return execFileSync('node', [cliPath, ...args], { encoding: 'utf8', timeout: 5000 });
  } catch (error) {
    return error.stdout || error.stderr || error.message;
  }
}

console.log('Feishu CLI Test Suite');
console.log('=====================');

// ==========================================
// Parser Tests
// ==========================================
section('parseUrl');

test('parses docx URLs', () => {
  expect(parseUrl('https://xxx.feishu.cn/docx/ABC123def')).toEqual({ type: 'docx', token: 'ABC123def' });
});

test('parses wiki URLs', () => {
  expect(parseUrl('https://xxx.feishu.cn/wiki/WikiToken123')).toEqual({ type: 'wiki', token: 'WikiToken123' });
});

test('parses sheets URLs', () => {
  expect(parseUrl('https://company.feishu.cn/sheets/SheetToken456')).toEqual({ type: 'sheets', token: 'SheetToken456' });
});

test('parses bitable URLs', () => {
  expect(parseUrl('https://xxx.feishu.cn/base/BaseToken789')).toEqual({ type: 'bitable', token: 'BaseToken789' });
});

test('parses drive folder URLs', () => {
  expect(parseUrl('https://xxx.feishu.cn/drive/folder/FolderToken123')).toEqual({ type: 'drive', token: 'FolderToken123' });
});

test('parses file URLs', () => {
  expect(parseUrl('https://xxx.feishu.cn/file/FileToken456')).toEqual({ type: 'file', token: 'FileToken456' });
});

test('parses lark.cn URLs (international)', () => {
  expect(parseUrl('https://xxx.lark.cn/docx/LarkDoc123')).toEqual({ type: 'docx', token: 'LarkDoc123' });
});

test('returns null for unsupported URLs', () => {
  expect(parseUrl('https://google.com')).toBeNull();
  expect(parseUrl('not a url')).toBeNull();
  expect(parseUrl('https://feishu.cn/unknown/ABC')).toBeNull();
});

test('handles URLs with query params', () => {
  expect(parseUrl('https://xxx.feishu.cn/base/ABC123?table=tblXXX&view=vewYYY')).toEqual({ type: 'bitable', token: 'ABC123' });
});

// ==========================================
section('extractTableId');

test('extracts table ID from URL', () => {
  expect(extractTableId('https://xxx.feishu.cn/base/ABC?table=tblXYZ')).toBe('tblXYZ');
});

test('extracts table ID when not first param', () => {
  expect(extractTableId('https://xxx.feishu.cn/base/ABC?view=vew123&table=tblABC')).toBe('tblABC');
});

test('returns null when no table param', () => {
  expect(extractTableId('https://xxx.feishu.cn/base/ABC')).toBeNull();
  expect(extractTableId('https://xxx.feishu.cn/base/ABC?view=vew123')).toBeNull();
});

// ==========================================
section('isUrl');

test('returns true for feishu.cn URLs', () => {
  expect(isUrl('https://xxx.feishu.cn/docx/ABC')).toBe(true);
  expect(isUrl('feishu.cn/docx/ABC')).toBe(true);
});

test('returns true for lark.cn URLs', () => {
  expect(isUrl('https://xxx.lark.cn/docx/ABC')).toBe(true);
});

test('returns false for non-Feishu URLs', () => {
  expect(isUrl('ABC123')).toBe(false);
  expect(isUrl('https://google.com')).toBe(false);
});

// ==========================================
section('smartParse');

test('extracts token from URL', () => {
  expect(smartParse('https://xxx.feishu.cn/docx/ABC123', 'docx')).toBe('ABC123');
});

test('returns raw token if not a URL', () => {
  expect(smartParse('ABC123', 'docx')).toBe('ABC123');
});

test('returns input if URL parse fails', () => {
  expect(smartParse('https://unknown.com/abc', 'docx')).toBe('https://unknown.com/abc');
});

// ==========================================
// CLI Integration Tests
// ==========================================
section('CLI Commands');

test('--help shows all commands', () => {
  const output = runCli(['--help']);
  expect(output).toContain('doc');
  expect(output).toContain('bitable');
  expect(output).toContain('sheet');
  expect(output).toContain('drive');
  expect(output).toContain('wiki');
  expect(output).toContain('parse-url');
});

test('doc --help shows doc commands', () => {
  const output = runCli(['doc', '--help']);
  expect(output).toContain('get');
  expect(output).toContain('raw');
  expect(output).toContain('blocks');
  expect(output).toContain('create');
});

test('bitable --help shows bitable commands', () => {
  const output = runCli(['bitable', '--help']);
  expect(output).toContain('info');
  expect(output).toContain('tables');
  expect(output).toContain('fields');
  expect(output).toContain('records');
  expect(output).toContain('search');
  expect(output).toContain('create');
  expect(output).toContain('update');
  expect(output).toContain('delete');
});

test('sheet --help shows sheet commands', () => {
  const output = runCli(['sheet', '--help']);
  expect(output).toContain('info');
  expect(output).toContain('list');
  expect(output).toContain('read');
});

test('drive --help shows drive commands', () => {
  const output = runCli(['drive', '--help']);
  expect(output).toContain('info');
  expect(output).toContain('list');
  expect(output).toContain('create-folder');
  expect(output).toContain('search');
  expect(output).toContain('download');
});

test('wiki --help shows wiki commands', () => {
  const output = runCli(['wiki', '--help']);
  expect(output).toContain('spaces');
  expect(output).toContain('space');
  expect(output).toContain('nodes');
  expect(output).toContain('node');
  expect(output).toContain('content');
  expect(output).toContain('create');
});

test('parse-url parses docx URL correctly', () => {
  const output = runCli(['parse-url', 'https://xxx.feishu.cn/docx/ABC123']);
  expect(output).toContain('Type: docx');
  expect(output).toContain('Token: ABC123');
});

test('parse-url --json outputs JSON', () => {
  const output = runCli(['parse-url', 'https://xxx.feishu.cn/base/XYZ789', '--json']);
  const json = JSON.parse(output);
  expect(json.type).toBe('bitable');
  expect(json.token).toBe('XYZ789');
});

// ==========================================
// Summary
// ==========================================
console.log('\n' + '='.repeat(40));
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(40));
process.exit(failed > 0 ? 1 : 0);
