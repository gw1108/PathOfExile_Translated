// Runtime schema validation against the upstream JSON Schemas
// (data-formats/). This is the tripwire for upstream format changes: a
// validation failure should fail the run loudly rather than export garbage.

import Ajv from 'ajv';
import draft6MetaSchema from 'ajv/dist/refs/json-schema-draft-06.json' with { type: 'json' };

const ajv = new Ajv({ strict: false, allErrors: false, validateFormats: false });
ajv.addMetaSchema(draft6MetaSchema);

/**
 * Validates `data` against `schema`. Returns an empty array when valid,
 * otherwise a list of human-readable error strings. Throws only if the
 * schema itself cannot be compiled (caller decides how to degrade).
 */
export function validateAgainstSchema(schema: object, data: unknown, name: string): string[] {
  const validate = ajv.compile(schema);
  if (validate(data)) return [];
  return (validate.errors ?? []).map(
    (e) => `${name}${e.instancePath || ''}: ${e.message ?? 'invalid'}`,
  );
}
