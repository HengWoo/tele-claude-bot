const { Command } = require('commander');
const client = require('../lib/client');
const { smartParse, extractTableId } = require('../lib/parser');
const { output, outputTable, outputRecords, handleError } = require('../lib/output');

const bitable = new Command('bitable')
  .alias('base')
  .description('Bitable operations (bitable:app scope)');

bitable
  .command('info <appToken>')
  .description('Get bitable app info')
  .option('--json', 'Output as JSON')
  .action(async (appToken, options) => {
    try {
      const token = smartParse(appToken, 'bitable');
      const res = await client.bitable.v1.app.get({
        path: { app_token: token },
      });

      if (options.json) {
        output(res.data, { json: true });
      } else {
        outputTable({
          'App Token': res.data.app.app_token,
          'Name': res.data.app.name,
          'Revision': res.data.app.revision,
        });
      }
    } catch (error) {
      handleError(error);
    }
  });

bitable
  .command('tables <appToken>')
  .description('List all tables in a bitable')
  .option('--json', 'Output as JSON')
  .action(async (appToken, options) => {
    try {
      const token = smartParse(appToken, 'bitable');
      const res = await client.bitable.v1.appTable.list({
        path: { app_token: token },
      });

      if (options.json) {
        output(res.data, { json: true });
      } else {
        const tables = res.data.items || [];
        console.log(`Found ${tables.length} tables:\n`);
        for (const table of tables) {
          console.log(`[${table.table_id}] ${table.name}`);
          if (table.revision) {
            console.log(`    Revision: ${table.revision}`);
          }
        }
      }
    } catch (error) {
      handleError(error);
    }
  });

bitable
  .command('fields <appToken> <tableId>')
  .description('List fields in a table')
  .option('--json', 'Output as JSON')
  .action(async (appToken, tableId, options) => {
    try {
      const token = smartParse(appToken, 'bitable');
      const res = await client.bitable.v1.appTableField.list({
        path: { app_token: token, table_id: tableId },
      });

      if (options.json) {
        output(res.data, { json: true });
      } else {
        const fields = res.data.items || [];
        console.log(`Found ${fields.length} fields:\n`);
        for (const field of fields) {
          console.log(`[${field.field_id}] ${field.field_name} (${field.type})`);
          if (field.property) {
            console.log(`    Properties: ${JSON.stringify(field.property)}`);
          }
        }
      }
    } catch (error) {
      handleError(error);
    }
  });

bitable
  .command('records <appToken> <tableId>')
  .description('List records in a table')
  .option('--json', 'Output as JSON')
  .option('--page-size <n>', 'Number of records per page', '20')
  .option('--page-token <token>', 'Page token for pagination')
  .option('--view <viewId>', 'View ID to use')
  .action(async (appToken, tableId, options) => {
    try {
      const token = smartParse(appToken, 'bitable');
      const params = {
        page_size: parseInt(options.pageSize, 10),
      };
      if (options.pageToken) params.page_token = options.pageToken;
      if (options.view) params.view_id = options.view;

      const res = await client.bitable.v1.appTableRecord.list({
        path: { app_token: token, table_id: tableId },
        params,
      });

      if (options.json) {
        output(res.data, { json: true });
      } else {
        const records = res.data.items || [];
        console.log(`Found ${records.length} records (has_more: ${res.data.has_more}):\n`);
        outputRecords(records);
        if (res.data.page_token) {
          console.log(`\nNext page: --page-token ${res.data.page_token}`);
        }
      }
    } catch (error) {
      handleError(error);
    }
  });

bitable
  .command('search <appToken> <tableId>')
  .description('Search records with filter')
  .option('--filter <json>', 'Filter condition as JSON')
  .option('--sort <json>', 'Sort conditions as JSON array')
  .option('--fields <fields>', 'Comma-separated field names to return')
  .option('--page-size <n>', 'Number of records per page', '20')
  .option('--json', 'Output as JSON')
  .action(async (appToken, tableId, options) => {
    try {
      const token = smartParse(appToken, 'bitable');
      const data = {
        page_size: parseInt(options.pageSize, 10),
      };

      if (options.filter) {
        data.filter = JSON.parse(options.filter);
      }
      if (options.sort) {
        data.sort = JSON.parse(options.sort);
      }
      if (options.fields) {
        data.field_names = options.fields.split(',').map(f => f.trim());
      }

      const res = await client.bitable.v1.appTableRecord.search({
        path: { app_token: token, table_id: tableId },
        data,
      });

      if (options.json) {
        output(res.data, { json: true });
      } else {
        const records = res.data.items || [];
        console.log(`Found ${records.length} records:\n`);
        outputRecords(records);
      }
    } catch (error) {
      handleError(error);
    }
  });

bitable
  .command('create <appToken> <tableId>')
  .description('Create a new record')
  .requiredOption('--data <json>', 'Record data as JSON object')
  .option('--json', 'Output as JSON')
  .action(async (appToken, tableId, options) => {
    try {
      const token = smartParse(appToken, 'bitable');
      const fields = JSON.parse(options.data);

      const res = await client.bitable.v1.appTableRecord.create({
        path: { app_token: token, table_id: tableId },
        data: { fields },
      });

      if (options.json) {
        output(res.data, { json: true });
      } else {
        console.log(`Created record: ${res.data.record.record_id}`);
        outputTable(res.data.record.fields);
      }
    } catch (error) {
      handleError(error);
    }
  });

bitable
  .command('update <appToken> <tableId> <recordId>')
  .description('Update an existing record')
  .requiredOption('--data <json>', 'Record data as JSON object')
  .option('--json', 'Output as JSON')
  .action(async (appToken, tableId, recordId, options) => {
    try {
      const token = smartParse(appToken, 'bitable');
      const fields = JSON.parse(options.data);

      const res = await client.bitable.v1.appTableRecord.update({
        path: { app_token: token, table_id: tableId, record_id: recordId },
        data: { fields },
      });

      if (options.json) {
        output(res.data, { json: true });
      } else {
        console.log(`Updated record: ${res.data.record.record_id}`);
        outputTable(res.data.record.fields);
      }
    } catch (error) {
      handleError(error);
    }
  });

bitable
  .command('delete <appToken> <tableId> <recordId>')
  .description('Delete a record')
  .option('--json', 'Output as JSON')
  .action(async (appToken, tableId, recordId, options) => {
    try {
      const token = smartParse(appToken, 'bitable');

      const res = await client.bitable.v1.appTableRecord.delete({
        path: { app_token: token, table_id: tableId, record_id: recordId },
      });

      if (options.json) {
        output(res.data, { json: true });
      } else {
        console.log(`Deleted record: ${recordId}`);
      }
    } catch (error) {
      handleError(error);
    }
  });

module.exports = bitable;
