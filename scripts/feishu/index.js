#!/usr/bin/env node
const { Command } = require('commander');
const { parseUrl } = require('./lib/parser');
const { output, handleError } = require('./lib/output');

const program = new Command();

program
  .name('feishu')
  .description('Feishu API CLI - Documents, Sheets, Bitable, Drive, Wiki')
  .version('1.0.0');

// Add subcommands
program.addCommand(require('./commands/doc'));
program.addCommand(require('./commands/bitable'));
program.addCommand(require('./commands/sheet'));
program.addCommand(require('./commands/drive'));
program.addCommand(require('./commands/wiki'));

// Utility: parse URL
program
  .command('parse-url <url>')
  .description('Extract token/id from a Feishu URL')
  .option('--json', 'Output as JSON')
  .action((url, options) => {
    const result = parseUrl(url);
    if (!result) {
      console.error('Could not parse URL. Supported formats:');
      console.error('  - https://xxx.feishu.cn/docx/ABC123');
      console.error('  - https://xxx.feishu.cn/wiki/ABC123');
      console.error('  - https://xxx.feishu.cn/sheets/ABC123');
      console.error('  - https://xxx.feishu.cn/base/ABC123');
      console.error('  - https://xxx.feishu.cn/drive/folder/ABC123');
      console.error('  - https://xxx.feishu.cn/file/ABC123');
      process.exit(1);
    }

    if (options.json) {
      output(result, { json: true });
    } else {
      console.log(`Type: ${result.type}`);
      console.log(`Token: ${result.token}`);
    }
  });

// Parse and execute
program.parse();
