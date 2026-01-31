# Feishu CLI

Command-line tool for accessing Feishu (Lark) APIs - Documents, Spreadsheets, Bitable, Drive, and Wiki.

## Setup

```bash
cd scripts/feishu
npm install
```

Requires environment variables in project root `.env`:
```
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_DOMAIN=feishu  # or "lark" for international
```

## Usage

```bash
node scripts/feishu <service> <action> [args] [--flags]
```

### Document Commands

```bash
# Get document metadata
node scripts/feishu doc get <document_id>

# Get plain text content
node scripts/feishu doc raw <document_id>

# Get structured blocks
node scripts/feishu doc blocks <document_id>

# Create new document
node scripts/feishu doc create "My Title" --folder <folder_token>
```

### Bitable Commands

```bash
# Get bitable info
node scripts/feishu bitable info <app_token>

# List all tables
node scripts/feishu bitable tables <app_token>

# List fields in a table
node scripts/feishu bitable fields <app_token> <table_id>

# List records
node scripts/feishu bitable records <app_token> <table_id>

# Search with filter
node scripts/feishu bitable search <app_token> <table_id> \
  --filter '{"conditions":[{"field_name":"Status","operator":"is","value":["Active"]}]}'

# Create record
node scripts/feishu bitable create <app_token> <table_id> \
  --data '{"Name":"John","Status":"Active"}'

# Update record
node scripts/feishu bitable update <app_token> <table_id> <record_id> \
  --data '{"Status":"Completed"}'

# Delete record
node scripts/feishu bitable delete <app_token> <table_id> <record_id>
```

### Sheet Commands

```bash
# Get spreadsheet info
node scripts/feishu sheet info <spreadsheet_token>

# List all sheets/tabs
node scripts/feishu sheet list <spreadsheet_token>

# Read cell range
node scripts/feishu sheet read <spreadsheet_token> "Sheet1!A1:C10"
```

### Drive Commands

```bash
# List files in root folder
node scripts/feishu drive list

# List files in a specific folder
node scripts/feishu drive list <folder_token>

# Get file/folder metadata
node scripts/feishu drive info <file_token>

# Create a new folder
node scripts/feishu drive create-folder "My Folder" --parent <folder_token>

# Search for files
node scripts/feishu drive search "keyword" --type doc
```

### Wiki Commands

```bash
# List all wiki spaces
node scripts/feishu wiki spaces

# Get wiki space info
node scripts/feishu wiki space <space_id>

# List nodes in a wiki space
node scripts/feishu wiki nodes <space_id>

# Get wiki node info
node scripts/feishu wiki node <node_token>

# Get wiki node content (reads underlying document)
node scripts/feishu wiki content <node_token>

# Create a new wiki node
node scripts/feishu wiki create <space_id> "My Page" --parent <parent_node>
```

### Utility Commands

```bash
# Parse Feishu URL to extract token
node scripts/feishu parse-url "https://xxx.feishu.cn/docx/ABC123"
# Output: Type: docx, Token: ABC123
```

## URL Support

All commands accept either raw tokens or full Feishu URLs:

```bash
# Both of these work:
node scripts/feishu doc raw ABC123
node scripts/feishu doc raw "https://xxx.feishu.cn/docx/ABC123"
```

## Output Formats

All commands support `--json` flag for JSON output:

```bash
node scripts/feishu doc get ABC123 --json
```

## Required Permissions

| Service | Scope | Access |
|---------|-------|--------|
| Documents | `docx:document` | Read/Write |
| Bitable | `bitable:app` | Read/Write |
| Sheets | `sheets:spreadsheet:readonly` | Read-only |
| Drive | `drive:drive` | Read/Write |
| Wiki | `wiki:wiki` | Read/Write |

## Running Tests

```bash
node scripts/feishu/test-runner.js
```
