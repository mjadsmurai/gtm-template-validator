/**
 * GTM templates encode web permission parameters as a small type-tagged tree:
 *   1 -> string
 *   2 -> list
 *   3 -> map
 *   8 -> boolean
 *
 * These helpers convert between that representation and plain JS values so the
 * rest of the validator can compare resources without knowing the encoding.
 */

export function decodePermissionValue(value) {
  if (value === null || value === undefined || typeof value !== 'object') {
    return undefined;
  }

  switch (value.type) {
    case 1:
      return value.string;
    case 2:
      return (value.listItem || []).map((item) => decodePermissionValue(item));
    case 3: {
      const decoded = {};
      const keys = value.mapKey || [];
      const values = value.mapValue || [];
      keys.forEach((key, index) => {
        decoded[decodeMapKey(key)] = decodePermissionValue(values[index]);
      });
      return decoded;
    }
    case 8:
      return value.boolean;
    default:
      return undefined;
  }
}

function decodeMapKey(key) {
  if (typeof key === 'string') return key;
  if (key && typeof key === 'object' && typeof key.string === 'string') return key.string;
  return String(key);
}

export function decodePermission(instance) {
  const params = {};
  for (const param of (instance && instance.param) || []) {
    params[param.key] = decodePermissionValue(param.value);
  }
  return params;
}

export function decodePermissions(permissions) {
  return (permissions || []).map((permission) => ({
    publicId: permission && permission.instance && permission.instance.key
      ? permission.instance.key.publicId
      : undefined,
    params: decodePermission(permission && permission.instance),
    raw: permission,
  }));
}

/**
 * Inverse of decodePermissionValue. Used by tests (and useful for tooling).
 */
export function encodePermissionValue(value) {
  if (typeof value === 'string') {
    return { type: 1, string: value };
  }
  if (typeof value === 'boolean') {
    return { type: 8, boolean: value };
  }
  if (typeof value === 'number') {
    return { type: 1, string: String(value) };
  }
  if (Array.isArray(value)) {
    return { type: 2, listItem: value.map((item) => encodePermissionValue(item)) };
  }
  if (value && typeof value === 'object') {
    const mapKey = [];
    const mapValue = [];
    for (const [key, item] of Object.entries(value)) {
      mapKey.push({ type: 1, string: key });
      mapValue.push(encodePermissionValue(item));
    }
    return { type: 3, mapKey, mapValue };
  }
  return { type: 1, string: String(value) };
}

export function encodePermission(publicId, params) {
  return {
    instance: {
      key: { publicId, versionId: '1' },
      param: Object.entries(params || {}).map(([key, value]) => ({
        key,
        value: encodePermissionValue(value),
      })),
    },
  };
}
