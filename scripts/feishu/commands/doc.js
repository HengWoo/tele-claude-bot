const { Command } = require('commander');
const client = require('../lib/client');
const { smartParse } = require('../lib/parser');
const { output, outputTable, handleError } = require('../lib/output');

const doc = new Command('doc')
  .description('Document operations (docx:document scope)');

doc
  .command('get <documentId>')
  .description('Get document metadata (title, revision)')
  .option('--json', 'Output as JSON')
  .action(async (documentId, options) => {
    try {
      const docId = smartParse(documentId, 'docx');
      const res = await client.docx.v1.document.get({
        path: { document_id: docId },
      });

      if (options.json) {
        output(res.data, { json: true });
      } else {
        outputTable({
          'Document ID': res.data.document.document_id,
          'Title': res.data.document.title,
          'Revision': res.data.document.revision_id,
        });
      }
    } catch (error) {
      handleError(error);
    }
  });

doc
  .command('raw <documentId>')
  .description('Get plain text content of a document')
  .option('--json', 'Output as JSON with metadata')
  .action(async (documentId, options) => {
    try {
      const docId = smartParse(documentId, 'docx');
      const res = await client.docx.v1.document.rawContent({
        path: { document_id: docId },
      });

      if (options.json) {
        output(res.data, { json: true });
      } else {
        console.log(res.data.content);
      }
    } catch (error) {
      handleError(error);
    }
  });

doc
  .command('blocks <documentId>')
  .description('Get document blocks (structured content)')
  .option('--json', 'Output as JSON')
  .option('--page-size <n>', 'Number of blocks per page', '500')
  .action(async (documentId, options) => {
    try {
      const docId = smartParse(documentId, 'docx');
      const res = await client.docx.v1.documentBlock.list({
        path: { document_id: docId },
        params: {
          page_size: parseInt(options.pageSize, 10),
        },
      });

      if (options.json) {
        output(res.data, { json: true });
      } else {
        const blocks = res.data.items || [];
        console.log(`Found ${blocks.length} blocks:\n`);
        for (const block of blocks) {
          const type = block.block_type;
          let preview = '';

          // Extract text preview for common block types
          if (block.paragraph?.elements) {
            preview = block.paragraph.elements
              .map(e => e.text_run?.content || '')
              .join('')
              .slice(0, 80);
          } else if (block.heading1?.elements) {
            preview = `# ${block.heading1.elements.map(e => e.text_run?.content || '').join('')}`;
          } else if (block.heading2?.elements) {
            preview = `## ${block.heading2.elements.map(e => e.text_run?.content || '').join('')}`;
          } else if (block.code?.elements) {
            preview = `[code: ${block.code.style?.language || 'unknown'}]`;
          }

          console.log(`[${block.block_id}] ${type}: ${preview}`);
        }
      }
    } catch (error) {
      handleError(error);
    }
  });

doc
  .command('create <title>')
  .description('Create a new document')
  .option('--folder <folderId>', 'Parent folder token')
  .option('--json', 'Output as JSON')
  .action(async (title, options) => {
    try {
      const res = await client.docx.v1.document.create({
        data: {
          title,
          folder_token: options.folder,
        },
      });

      if (options.json) {
        output(res.data, { json: true });
      } else {
        outputTable({
          'Document ID': res.data.document.document_id,
          'Title': res.data.document.title,
          'Revision': res.data.document.revision_id,
          'URL': `https://feishu.cn/docx/${res.data.document.document_id}`,
        });
      }
    } catch (error) {
      handleError(error);
    }
  });

module.exports = doc;
