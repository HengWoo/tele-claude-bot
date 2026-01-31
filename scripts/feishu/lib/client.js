const lark = require('@larksuiteoapi/node-sdk');
const path = require('path');

// Load .env from project root
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const appId = process.env.FEISHU_APP_ID;
const appSecret = process.env.FEISHU_APP_SECRET;
const domain = process.env.FEISHU_DOMAIN || 'feishu';

if (!appId || !appSecret) {
  console.error('Error: FEISHU_APP_ID and FEISHU_APP_SECRET must be set in .env');
  process.exit(1);
}

const client = new lark.Client({
  appId,
  appSecret,
  domain: domain === 'lark' ? lark.Domain.Lark : lark.Domain.Feishu,
  loggerLevel: lark.LoggerLevel.error, // Suppress info logs
});

module.exports = client;
