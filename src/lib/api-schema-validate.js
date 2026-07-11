// Minimal JSON Schema (draft-07 subset) validator for the static API resources.
// Deliberately small — supports only the keywords used by the API schemas
// (src/api/schema/*.schema.json) so we validate generated output in tests
// without adding a runtime dependency (issue #136, NFR-01). Not a general-
// purpose validator: unsupported keywords are ignored, not enforced.

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value; // 'object' | 'string' | 'number' | 'boolean'
}

function matchesType(value, type) {
  const actual = typeOf(value);
  if (type === 'number') return actual === 'number' || actual === 'integer';
  if (type === 'object') return actual === 'object';
  return actual === type;
}

function resolveRef(ref, root) {
  if (!ref.startsWith('#/')) throw new Error(`unsupported $ref: ${ref}`);
  let node = root;
  for (const seg of ref.slice(2).split('/')) {
    node = node?.[seg.replace(/~1/g, '/').replace(/~0/g, '~')];
    if (node === undefined) throw new Error(`$ref not found: ${ref}`);
  }
  return node;
}

function check(schema, value, root, path, errors) {
  if (schema.$ref) {
    return check(resolveRef(schema.$ref, root), value, root, path, errors);
  }

  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${path}: expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: ${JSON.stringify(value)} not in enum ${JSON.stringify(schema.enum)}`);
  }

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(value, t))) {
      errors.push(`${path}: expected type ${types.join('|')}, got ${typeOf(value)}`);
      return; // further keyword checks assume the type held
    }
  }

  if (schema.oneOf) {
    const passes = schema.oneOf.filter((sub) => check(sub, value, root, path, []) === true);
    if (passes.length !== 1) {
      errors.push(`${path}: expected to match exactly one of oneOf, matched ${passes.length}`);
    }
  }

  if (typeof value === 'string' && schema.pattern) {
    if (!new RegExp(schema.pattern).test(value)) {
      errors.push(`${path}: ${JSON.stringify(value)} does not match pattern ${schema.pattern}`);
    }
  }

  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) {
    errors.push(`${path}: ${value} < minimum ${schema.minimum}`);
  }

  if (typeOf(value) === 'object') {
    for (const req of schema.required ?? []) {
      if (!(req in value)) errors.push(`${path}: missing required property "${req}"`);
    }
    const props = schema.properties ?? {};
    for (const [k, v] of Object.entries(value)) {
      if (props[k]) {
        check(props[k], v, root, `${path}/${k}`, errors);
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}: unexpected property "${k}"`);
      }
    }
  }

  if (Array.isArray(value) && schema.items) {
    value.forEach((item, i) => check(schema.items, item, root, `${path}[${i}]`, errors));
  }

  return errors.length === 0;
}

/** Validate `data` against `schema`. Returns { valid, errors }. */
export function validate(schema, data) {
  const errors = [];
  check(schema, data, schema, '$', errors);
  return { valid: errors.length === 0, errors };
}
