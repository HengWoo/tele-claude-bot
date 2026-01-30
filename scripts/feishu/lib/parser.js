/**
 * Parse Feishu URLs to extract document/sheet/bitable tokens
 */

const URL_PATTERNS = {
  // Document: https://xxx.feishu.cn/docx/ABC123
  docx: /(?:feishu|lark)\.cn\/docx\/([a-zA-Z0-9]+)/,
  // Wiki document: https://xxx.feishu.cn/wiki/ABC123
  wiki: /(?:feishu|lark)\.cn\/wiki\/([a-zA-Z0-9]+)/,
  // Spreadsheet: https://xxx.feishu.cn/sheets/ABC123
  sheets: /(?:feishu|lark)\.cn\/sheets\/([a-zA-Z0-9]+)/,
  // Bitable: https://xxx.feishu.cn/base/ABC123
  bitable: /(?:feishu|lark)\.cn\/base\/([a-zA-Z0-9]+)/,
  // Drive folder: https://xxx.feishu.cn/drive/folder/ABC123
  drive: /(?:feishu|lark)\.cn\/drive\/folder\/([a-zA-Z0-9]+)/,
  // Drive file: https://xxx.feishu.cn/file/ABC123
  file: /(?:feishu|lark)\.cn\/file\/([a-zA-Z0-9]+)/,
};

/**
 * Parse a Feishu URL and extract the token/id
 * @param {string} url - The Feishu URL to parse
 * @returns {{ type: string, token: string } | null}
 */
function parseUrl(url) {
  for (const [type, pattern] of Object.entries(URL_PATTERNS)) {
    const match = url.match(pattern);
    if (match) {
      return { type, token: match[1] };
    }
  }
  return null;
}

/**
 * Extract table ID from Bitable URL query params
 * https://xxx.feishu.cn/base/ABC123?table=tblXXX
 * @param {string} url
 * @returns {string | null}
 */
function extractTableId(url) {
  const match = url.match(/[?&]table=([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

/**
 * Detect if input is a URL or a raw token
 * @param {string} input
 * @returns {boolean}
 */
function isUrl(input) {
  return input.includes('feishu.cn') || input.includes('lark.cn');
}

/**
 * Smart parse - accepts either URL or raw token
 * @param {string} input - URL or raw token
 * @param {string} expectedType - Expected document type (docx, sheets, bitable)
 * @returns {string} - The extracted or original token
 */
function smartParse(input, expectedType) {
  if (isUrl(input)) {
    const parsed = parseUrl(input);
    if (parsed) {
      return parsed.token;
    }
  }
  return input;
}

module.exports = {
  parseUrl,
  extractTableId,
  isUrl,
  smartParse,
};
