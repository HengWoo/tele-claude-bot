const { Command } = require('commander');
const client = require('../lib/client');
const { smartParse } = require('../lib/parser');
const { output, outputTable, handleError } = require('../lib/output');

const sheet = new Command('sheet')
  .alias('sheets')
  .description('Spreadsheet operations (sheets:spreadsheet:readonly scope)');

sheet
  .command('info <spreadsheetToken>')
  .description('Get spreadsheet metadata')
  .option('--json', 'Output as JSON')
  .action(async (spreadsheetToken, options) => {
    try {
      const token = smartParse(spreadsheetToken, 'sheets');
      const res = await client.sheets.v3.spreadsheet.get({
        path: { spreadsheet_token: token },
      });

      if (options.json) {
        output(res.data, { json: true });
      } else {
        const ss = res.data.spreadsheet;
        outputTable({
          'Token': ss.spreadsheet_token,
          'Title': ss.title,
          'URL': ss.url,
        });
      }
    } catch (error) {
      handleError(error);
    }
  });

sheet
  .command('list <spreadsheetToken>')
  .description('List all sheets/tabs in a spreadsheet')
  .option('--json', 'Output as JSON')
  .action(async (spreadsheetToken, options) => {
    try {
      const token = smartParse(spreadsheetToken, 'sheets');
      const res = await client.sheets.v3.spreadsheetSheet.query({
        path: { spreadsheet_token: token },
      });

      if (options.json) {
        output(res.data, { json: true });
      } else {
        const sheets = res.data.sheets || [];
        console.log(`Found ${sheets.length} sheets:\n`);
        for (const s of sheets) {
          console.log(`[${s.sheet_id}] ${s.title}`);
          console.log(`    Index: ${s.index}, Rows: ${s.grid_properties?.row_count || '?'}, Cols: ${s.grid_properties?.column_count || '?'}`);
        }
      }
    } catch (error) {
      handleError(error);
    }
  });

sheet
  .command('read <spreadsheetToken> <range>')
  .description('Read cell values from a range (e.g., "Sheet1!A1:C10" or "sheetId!A1:C10")')
  .option('--json', 'Output as JSON')
  .option('--render <mode>', 'Value render mode: ToString, FormattedValue, Formula, UnformattedValue', 'ToString')
  .action(async (spreadsheetToken, range, options) => {
    try {
      const token = smartParse(spreadsheetToken, 'sheets');

      const res = await client.sheets.v2.spreadsheetSheetFilterView.query({
        path: { spreadsheet_token: token },
        params: { range },
      });

      // Fallback to direct range query
      const rangeRes = await client.request({
        method: 'GET',
        url: `https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${token}/values/${encodeURIComponent(range)}`,
        params: {
          valueRenderOption: options.render,
        },
      });

      if (options.json) {
        output(rangeRes.data, { json: true });
      } else {
        const data = rangeRes.data.data;
        if (data?.valueRange?.values) {
          const values = data.valueRange.values;
          console.log(`Range: ${data.valueRange.range}\n`);

          for (const row of values) {
            const cells = row.map(cell => {
              if (cell === null || cell === undefined) return '';
              if (typeof cell === 'object') return JSON.stringify(cell);
              return String(cell);
            });
            console.log(cells.join('\t'));
          }
        } else {
          console.log('No data found in range');
        }
      }
    } catch (error) {
      handleError(error);
    }
  });

module.exports = sheet;
