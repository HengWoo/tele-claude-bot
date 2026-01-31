const { Command } = require('commander');
const client = require('../lib/client');
const { smartParse } = require('../lib/parser');
const { output, outputTable, handleError } = require('../lib/output');

const drive = new Command('drive')
  .description('Drive operations (drive:drive scope)');

drive
  .command('info <fileToken>')
  .description('Get file/folder metadata')
  .option('--json', 'Output as JSON')
  .action(async (fileToken, options) => {
    try {
      const token = smartParse(fileToken, 'drive');
      const res = await client.drive.v1.file.get({
        path: { file_token: token },
      });

      if (options.json) {
        output(res.data, { json: true });
      } else {
        const file = res.data.file;
        outputTable({
          'Token': file.token,
          'Name': file.name,
          'Type': file.type,
          'Parent': file.parent_token || '-',
          'URL': file.url,
          'Created': file.created_time,
          'Modified': file.modified_time,
          'Owner': file.owner_id,
        });
      }
    } catch (error) {
      handleError(error);
    }
  });

drive
  .command('list [folderToken]')
  .description('List files in a folder (root if not specified)')
  .option('--json', 'Output as JSON')
  .option('--page-size <n>', 'Number of items per page', '50')
  .option('--page-token <token>', 'Page token for pagination')
  .action(async (folderToken, options) => {
    try {
      const params = {
        page_size: parseInt(options.pageSize, 10),
      };
      if (options.pageToken) params.page_token = options.pageToken;
      if (folderToken) params.folder_token = smartParse(folderToken, 'drive');

      const res = await client.drive.v1.file.list({
        params,
      });

      if (options.json) {
        output(res.data, { json: true });
      } else {
        const files = res.data.files || [];
        console.log(`Found ${files.length} items (has_more: ${res.data.has_more}):\n`);
        for (const file of files) {
          const icon = file.type === 'folder' ? '📁' : '📄';
          console.log(`${icon} [${file.token}] ${file.name} (${file.type})`);
        }
        if (res.data.page_token) {
          console.log(`\nNext page: --page-token ${res.data.page_token}`);
        }
      }
    } catch (error) {
      handleError(error);
    }
  });

drive
  .command('create-folder <name>')
  .description('Create a new folder')
  .option('--parent <folderToken>', 'Parent folder token')
  .option('--json', 'Output as JSON')
  .action(async (name, options) => {
    try {
      const res = await client.drive.v1.file.createFolder({
        data: {
          name,
          folder_token: options.parent,
        },
      });

      if (options.json) {
        output(res.data, { json: true });
      } else {
        console.log(`Created folder: ${res.data.token}`);
        console.log(`URL: ${res.data.url}`);
      }
    } catch (error) {
      handleError(error);
    }
  });

drive
  .command('search <query>')
  .description('Search for files')
  .option('--json', 'Output as JSON')
  .option('--page-size <n>', 'Number of results', '20')
  .option('--type <type>', 'Filter by type (doc, sheet, bitable, folder, etc.)')
  .action(async (query, options) => {
    try {
      const data = {
        search_key: query,
        count: parseInt(options.pageSize, 10),
      };
      if (options.type) {
        data.docs_types = [options.type];
      }

      const res = await client.suite.v1.driveExplorer.search({
        data,
      });

      if (options.json) {
        output(res.data, { json: true });
      } else {
        const files = res.data.docs_entities || [];
        console.log(`Found ${files.length} results:\n`);
        for (const file of files) {
          console.log(`[${file.docs_token}] ${file.docs_type}: ${file.title}`);
          if (file.url) console.log(`    ${file.url}`);
        }
      }
    } catch (error) {
      handleError(error);
    }
  });

drive
  .command('download <fileToken>')
  .description('Get download URL for a file')
  .option('--json', 'Output as JSON')
  .action(async (fileToken, options) => {
    try {
      const token = smartParse(fileToken, 'drive');

      // Get file info first to determine type
      const infoRes = await client.drive.v1.file.get({
        path: { file_token: token },
      });

      const file = infoRes.data.file;

      if (options.json) {
        output({ file, download_url: file.url }, { json: true });
      } else {
        outputTable({
          'Name': file.name,
          'Type': file.type,
          'URL': file.url,
        });
        console.log('\nNote: Use the URL to download. For docs/sheets, export first.');
      }
    } catch (error) {
      handleError(error);
    }
  });

module.exports = drive;
