import type { SqlFilter } from '../db/database';

export interface Token {
  raw: string;
  type: 'filter' | 'text';
  key?: string;
  operator?: string;
  value?: string;
}

export interface ParsedQuery {
  sqlFilters: SqlFilter[];
  semanticQuery: string;
  rawTokens: Token[];
}

const FILTER_REGEX = /^(ext|type|size|name|dir|modified)([:<>]=?)(.+)$/i;

function tokenizeInput(input: string): string[] {
  const tokens: string[] = [];
  const regex = /"([^"]+)"|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(input)) !== null) {
    tokens.push(match[1] ?? match[2]);
  }
  return tokens;
}

function parseSizeToBytes(raw: string): number {
  const lower = raw.toLowerCase();
  const num = parseFloat(lower);
  if (lower.endsWith('gb')) return num * 1024 * 1024 * 1024;
  if (lower.endsWith('mb')) return num * 1024 * 1024;
  if (lower.endsWith('kb')) return num * 1024;
  return num;
}

function buildSqlFilter(key: string, operator: string, value: string): SqlFilter | null {
  const k = key.toLowerCase();

  if (k === 'ext') {
    return { column: 'metadataTags', operator: 'LIKE', value: `%Ext:${value}%` };
  }
  if (k === 'type') {
    return { column: 'metadataTags', operator: 'LIKE', value: `%Type:${value}%` };
  }
  if (k === 'name') {
    return { column: 'fileName', operator: 'LIKE', value: `%${value}%` };
  }
  if (k === 'dir') {
    return { column: 'metadataTags', operator: 'LIKE', value: `%Dir:${value}%` };
  }
  if (k === 'size') {
    // Numeric size comparisons can't be done on the text metadataTags column.
    // Return a broad LIKE to keep the row in play; JS-layer post-filtering handles the numeric comparison.
    void parseSizeToBytes(value); // validate parse compiles; result used by caller via rawToken
    return { column: 'metadataTags', operator: 'LIKE', value: '%SizeKB:%' };
  }
  if (k === 'modified') {
    // ISO date string comparison stored as UTC epoch integer
    const epoch = Date.parse(value);
    if (!isNaN(epoch)) {
      const op = (operator === ':' ? '>=' : operator) as SqlFilter['operator'];
      return { column: 'lastModifiedUtc', operator: op, value: epoch };
    }
    return null;
  }
  return null;
}

export function parseQuery(input: string): ParsedQuery {
  const rawStrings = tokenizeInput(input.trim());
  const rawTokens: Token[] = [];
  const sqlFilters: SqlFilter[] = [];
  const textParts: string[] = [];

  for (const raw of rawStrings) {
    const match = FILTER_REGEX.exec(raw);
    if (match) {
      const [, key, operator, value] = match;
      const token: Token = { raw, type: 'filter', key, operator, value };
      rawTokens.push(token);
      const filter = buildSqlFilter(key, operator, value);
      if (filter) {
        sqlFilters.push(filter);
      }
    } else {
      rawTokens.push({ raw, type: 'text' });
      textParts.push(raw);
    }
  }

  return {
    sqlFilters,
    semanticQuery: textParts.join(' '),
    rawTokens,
  };
}
