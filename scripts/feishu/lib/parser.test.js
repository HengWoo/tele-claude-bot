const { describe, it, expect } = require('vitest');
const { parseUrl, extractTableId, isUrl, smartParse } = require('./parser');

describe('parser', () => {
  describe('parseUrl', () => {
    it('parses docx URLs', () => {
      const result = parseUrl('https://xxx.feishu.cn/docx/ABC123def');
      expect(result).toEqual({ type: 'docx', token: 'ABC123def' });
    });

    it('parses wiki URLs', () => {
      const result = parseUrl('https://xxx.feishu.cn/wiki/WikiToken123');
      expect(result).toEqual({ type: 'wiki', token: 'WikiToken123' });
    });

    it('parses sheets URLs', () => {
      const result = parseUrl('https://company.feishu.cn/sheets/SheetToken456');
      expect(result).toEqual({ type: 'sheets', token: 'SheetToken456' });
    });

    it('parses bitable URLs', () => {
      const result = parseUrl('https://xxx.feishu.cn/base/BaseToken789');
      expect(result).toEqual({ type: 'bitable', token: 'BaseToken789' });
    });

    it('parses lark.cn URLs (international)', () => {
      const result = parseUrl('https://xxx.lark.cn/docx/LarkDoc123');
      expect(result).toEqual({ type: 'docx', token: 'LarkDoc123' });
    });

    it('returns null for unsupported URLs', () => {
      expect(parseUrl('https://google.com')).toBeNull();
      expect(parseUrl('not a url')).toBeNull();
      expect(parseUrl('https://feishu.cn/unknown/ABC')).toBeNull();
    });

    it('handles URLs with query params', () => {
      const result = parseUrl('https://xxx.feishu.cn/base/ABC123?table=tblXXX&view=vewYYY');
      expect(result).toEqual({ type: 'bitable', token: 'ABC123' });
    });
  });

  describe('extractTableId', () => {
    it('extracts table ID from URL with table param', () => {
      const result = extractTableId('https://xxx.feishu.cn/base/ABC?table=tblXYZ');
      expect(result).toBe('tblXYZ');
    });

    it('extracts table ID when not first param', () => {
      const result = extractTableId('https://xxx.feishu.cn/base/ABC?view=vew123&table=tblABC');
      expect(result).toBe('tblABC');
    });

    it('returns null when no table param', () => {
      expect(extractTableId('https://xxx.feishu.cn/base/ABC')).toBeNull();
      expect(extractTableId('https://xxx.feishu.cn/base/ABC?view=vew123')).toBeNull();
    });
  });

  describe('isUrl', () => {
    it('returns true for feishu.cn URLs', () => {
      expect(isUrl('https://xxx.feishu.cn/docx/ABC')).toBe(true);
      expect(isUrl('feishu.cn/docx/ABC')).toBe(true);
    });

    it('returns true for lark.cn URLs', () => {
      expect(isUrl('https://xxx.lark.cn/docx/ABC')).toBe(true);
    });

    it('returns false for non-Feishu URLs', () => {
      expect(isUrl('ABC123')).toBe(false);
      expect(isUrl('https://google.com')).toBe(false);
    });
  });

  describe('smartParse', () => {
    it('extracts token from URL', () => {
      const result = smartParse('https://xxx.feishu.cn/docx/ABC123', 'docx');
      expect(result).toBe('ABC123');
    });

    it('returns raw token if not a URL', () => {
      const result = smartParse('ABC123', 'docx');
      expect(result).toBe('ABC123');
    });

    it('returns input if URL parse fails', () => {
      const result = smartParse('https://unknown.com/abc', 'docx');
      expect(result).toBe('https://unknown.com/abc');
    });
  });
});
