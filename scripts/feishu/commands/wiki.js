const { Command } = require('commander');
const client = require('../lib/client');
const { smartParse } = require('../lib/parser');
const { output, outputTable, handleError } = require('../lib/output');

const wiki = new Command('wiki')
  .description('Wiki/Knowledge Base operations (wiki:wiki scope)');

wiki
  .command('spaces')
  .description('List all wiki spaces')
  .option('--json', 'Output as JSON')
  .option('--page-size <n>', 'Number of spaces per page', '20')
  .option('--page-token <token>', 'Page token for pagination')
  .action(async (options) => {
    try {
      const params = {
        page_size: parseInt(options.pageSize, 10),
      };
      if (options.pageToken) params.page_token = options.pageToken;

      const res = await client.wiki.v2.space.list({
        params,
      });

      if (options.json) {
        output(res.data, { json: true });
      } else {
        const spaces = res.data.items || [];
        console.log(`Found ${spaces.length} wiki spaces:\n`);
        for (const space of spaces) {
          console.log(`[${space.space_id}] ${space.name}`);
          if (space.description) {
            console.log(`    ${space.description}`);
          }
        }
        if (res.data.page_token) {
          console.log(`\nNext page: --page-token ${res.data.page_token}`);
        }
      }
    } catch (error) {
      handleError(error);
    }
  });

wiki
  .command('space <spaceId>')
  .description('Get wiki space info')
  .option('--json', 'Output as JSON')
  .action(async (spaceId, options) => {
    try {
      const res = await client.wiki.v2.space.get({
        path: { space_id: spaceId },
      });

      if (options.json) {
        output(res.data, { json: true });
      } else {
        const space = res.data.space;
        outputTable({
          'Space ID': space.space_id,
          'Name': space.name,
          'Description': space.description || '-',
          'Visibility': space.visibility,
        });
      }
    } catch (error) {
      handleError(error);
    }
  });

wiki
  .command('nodes <spaceId>')
  .description('List nodes in a wiki space')
  .option('--json', 'Output as JSON')
  .option('--parent <nodeToken>', 'Parent node token (for nested nodes)')
  .option('--page-size <n>', 'Number of nodes per page', '50')
  .option('--page-token <token>', 'Page token for pagination')
  .action(async (spaceId, options) => {
    try {
      const params = {
        page_size: parseInt(options.pageSize, 10),
      };
      if (options.pageToken) params.page_token = options.pageToken;
      if (options.parent) params.parent_node_token = options.parent;

      const res = await client.wiki.v2.spaceNode.list({
        path: { space_id: spaceId },
        params,
      });

      if (options.json) {
        output(res.data, { json: true });
      } else {
        const nodes = res.data.items || [];
        console.log(`Found ${nodes.length} nodes:\n`);
        for (const node of nodes) {
          const icon = node.has_child ? '📁' : '📄';
          console.log(`${icon} [${node.node_token}] ${node.title} (${node.obj_type})`);
          if (node.obj_token) {
            console.log(`    Object: ${node.obj_token}`);
          }
        }
        if (res.data.page_token) {
          console.log(`\nNext page: --page-token ${res.data.page_token}`);
        }
      }
    } catch (error) {
      handleError(error);
    }
  });

wiki
  .command('node <nodeToken>')
  .description('Get wiki node info')
  .option('--json', 'Output as JSON')
  .action(async (nodeToken, options) => {
    try {
      const token = smartParse(nodeToken, 'wiki');
      const res = await client.wiki.v2.spaceNode.get({
        params: { token },
      });

      if (options.json) {
        output(res.data, { json: true });
      } else {
        const node = res.data.node;
        outputTable({
          'Node Token': node.node_token,
          'Title': node.title,
          'Type': node.obj_type,
          'Object Token': node.obj_token || '-',
          'Space ID': node.space_id,
          'Has Children': node.has_child,
          'Parent': node.parent_node_token || 'root',
        });
      }
    } catch (error) {
      handleError(error);
    }
  });

wiki
  .command('content <nodeToken>')
  .description('Get wiki node content (reads the underlying document)')
  .option('--json', 'Output as JSON')
  .action(async (nodeToken, options) => {
    try {
      const token = smartParse(nodeToken, 'wiki');

      // First get node info to find the underlying document
      const nodeRes = await client.wiki.v2.spaceNode.get({
        params: { token },
      });

      const node = nodeRes.data.node;

      if (node.obj_type !== 'doc' && node.obj_type !== 'docx') {
        console.log(`Node type is ${node.obj_type}, not a document.`);
        console.log(`Object token: ${node.obj_token}`);
        return;
      }

      // Read document content
      const docRes = await client.docx.v1.document.rawContent({
        path: { document_id: node.obj_token },
      });

      if (options.json) {
        output({
          node,
          content: docRes.data.content,
        }, { json: true });
      } else {
        console.log(`# ${node.title}\n`);
        console.log(docRes.data.content);
      }
    } catch (error) {
      handleError(error);
    }
  });

wiki
  .command('create <spaceId> <title>')
  .description('Create a new wiki node (document)')
  .option('--parent <nodeToken>', 'Parent node token')
  .option('--json', 'Output as JSON')
  .action(async (spaceId, title, options) => {
    try {
      const data = {
        obj_type: 'docx',
        title,
      };
      if (options.parent) {
        data.parent_node_token = options.parent;
      }

      const res = await client.wiki.v2.spaceNode.create({
        path: { space_id: spaceId },
        data,
      });

      if (options.json) {
        output(res.data, { json: true });
      } else {
        const node = res.data.node;
        outputTable({
          'Node Token': node.node_token,
          'Title': node.title,
          'Object Token': node.obj_token,
        });
      }
    } catch (error) {
      handleError(error);
    }
  });

module.exports = wiki;
