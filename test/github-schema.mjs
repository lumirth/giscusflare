import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { buildSchema, parse, validate, getOperationAST, getVariableValues } from 'graphql';

const bytes = gunzipSync(readFileSync(new URL('./github-schema.graphql.gz', import.meta.url)));
const provenance = JSON.parse(readFileSync(new URL('./github-schema.json', import.meta.url), 'utf8'));
if (createHash('sha256').update(bytes).digest('hex') !== provenance.sha256) throw new Error('GitHub schema snapshot does not match its provenance.');
const schema = buildSchema(bytes.toString('utf8'));
const documents = new Map();

/** Official provider types are the oracle; operation inventories are not. */
export function validateGitHubQuery(query, variables) {
  let document = documents.get(query);
  if (!document) {
    document = parse(query);
    const errors = validate(schema, document);
    if (errors.length) throw new Error('Published GitHub schema: ' + errors.map(error => error.message).join('; '));
    documents.set(query, document);
  }
  const operation = getOperationAST(document);
  const result = getVariableValues(schema, operation.variableDefinitions || [], variables);
  if (result.errors?.length) throw new Error('GitHub variable contract: ' + result.errors.map(error => error.message).join('; '));
}
