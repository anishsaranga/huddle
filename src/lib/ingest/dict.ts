/**
 * An empty object with no prototype, for maps keyed by payload data (source
 * names, stage names, unknown field names). With a plain `{}`, keys such as
 * `__proto__` or `constructor` would hit Object.prototype.
 */
export function dict<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}
