/**
 * Output formatting utilities
 */

/**
 * Output data as JSON or formatted text
 * @param {any} data - Data to output
 * @param {object} options - Output options
 * @param {boolean} options.json - Output as JSON
 */
function output(data, options = {}) {
  if (options.json) {
    console.log(JSON.stringify(data, null, 2));
  } else if (typeof data === 'string') {
    console.log(data);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

/**
 * Output a simple key-value table
 * @param {Record<string, any>} data
 */
function outputTable(data) {
  const maxKeyLen = Math.max(...Object.keys(data).map(k => k.length));
  for (const [key, value] of Object.entries(data)) {
    const displayValue = typeof value === 'object' ? JSON.stringify(value) : value;
    console.log(`${key.padEnd(maxKeyLen)}  ${displayValue}`);
  }
}

/**
 * Output records as a table
 * @param {Array<Record<string, any>>} records
 * @param {string[]} columns - Columns to display
 */
function outputRecords(records, columns = []) {
  if (records.length === 0) {
    console.log('No records found');
    return;
  }

  // Auto-detect columns if not provided
  if (columns.length === 0) {
    const first = records[0];
    columns = Object.keys(first.fields || first);
  }

  // Output as simple table
  for (const record of records) {
    const fields = record.fields || record;
    const values = columns.map(col => {
      const val = fields[col];
      if (val === null || val === undefined) return '-';
      if (typeof val === 'object') return JSON.stringify(val);
      return String(val);
    });
    console.log(`[${record.record_id || '-'}] ${values.join(' | ')}`);
  }
}

/**
 * Handle API errors consistently
 * @param {Error} error
 */
function handleError(error) {
  if (error.response?.data) {
    console.error('API Error:', JSON.stringify(error.response.data, null, 2));
  } else if (error.code) {
    console.error(`Error [${error.code}]: ${error.msg || error.message}`);
  } else {
    console.error('Error:', error.message);
  }
  process.exit(1);
}

module.exports = {
  output,
  outputTable,
  outputRecords,
  handleError,
};
