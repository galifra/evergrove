// A small JSON-schema subset validator for action arguments. Model output is
// untrusted: everything is checked, coerced where safe, and unknown keys are
// dropped before an action ever runs.

export function validateArgs(schema, args, path = 'args') {
  return check(schema, args, path)
}

function check(schema, value, path) {
  if (!schema) return { value }
  const t = schema.type

  if (value === undefined || value === null) return { value: undefined }

  if (schema.enum && t !== 'string' && !schema.enum.includes(value)) {
    return { error: `${path} must be one of: ${schema.enum.join(', ')}` }
  }

  if (t === 'string') {
    if (typeof value !== 'string') {
      if (typeof value === 'number') value = String(value)
      else return { error: `${path} must be text` }
    }
    const v = value.trim()
    if (schema.maxLength && v.length > schema.maxLength) return { error: `${path} is too long` }
    if (schema.enum && !schema.enum.includes(v)) return { error: `${path} must be one of: ${schema.enum.join(', ')}` }
    if (schema.pattern && !new RegExp(schema.pattern).test(v)) return { error: `${path} has the wrong format` }
    return { value: v }
  }

  if (t === 'number' || t === 'integer') {
    const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
    if (typeof n !== 'number' || !Number.isFinite(n)) return { error: `${path} must be a number` }
    if (t === 'integer' && !Number.isInteger(n)) return { error: `${path} must be a whole number` }
    if (schema.minimum !== undefined && n < schema.minimum) return { error: `${path} must be at least ${schema.minimum}` }
    if (schema.maximum !== undefined && n > schema.maximum) return { error: `${path} must be at most ${schema.maximum}` }
    return { value: n }
  }

  if (t === 'boolean') {
    if (typeof value !== 'boolean') return { error: `${path} must be true or false` }
    return { value }
  }

  if (t === 'array') {
    if (!Array.isArray(value)) return { error: `${path} must be a list` }
    if (schema.maxItems && value.length > schema.maxItems) return { error: `${path} has too many items` }
    const out = []
    for (let i = 0; i < value.length; i++) {
      const r = check(schema.items, value[i], `${path}[${i}]`)
      if (r.error) return r
      out.push(r.value)
    }
    return { value: out }
  }

  if (t === 'object') {
    if (typeof value !== 'object' || Array.isArray(value)) return { error: `${path} must be an object` }
    if (!schema.properties) return { value }
    const out = {}
    for (const [key, sub] of Object.entries(schema.properties)) {
      const r = check(sub, value[key], `${path}.${key}`)
      if (r.error) return r
      if (r.value !== undefined) out[key] = r.value
    }
    for (const req of schema.required ?? []) {
      if (out[req] === undefined || out[req] === '') return { error: `${path}.${req} is required` }
    }
    return { value: out }
  }

  return { value }
}
