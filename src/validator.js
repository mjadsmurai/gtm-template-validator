import { decodePermissions } from './gtm-value.js';
import { analyzeCode } from './static-analysis.js';
import { PERMISSION_LABELS } from './permissions-schema.js';

export const BLOCKS = {
  TERMS: '___TERMS_OF_SERVICE___',
  INFO: '___INFO___',
  PARAMETERS: '___TEMPLATE_PARAMETERS___',
  CODE: '___SANDBOXED_JS_FOR_WEB_TEMPLATE___',
  PERMISSIONS: '___WEB_PERMISSIONS___',
  TESTS: '___TESTS___',
  NOTES: '___NOTES___',
};

const EXPECTED_BLOCKS = [
  BLOCKS.TERMS,
  BLOCKS.INFO,
  BLOCKS.PARAMETERS,
  BLOCKS.CODE,
  BLOCKS.PERMISSIONS,
  BLOCKS.TESTS,
  BLOCKS.NOTES,
];

function issue(block, message, line, extra = {}) {
  return { block, message: line ? `${message} (line ${line})` : message, line, ...extra };
}

function lineAt(source, index) {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i += 1) {
    if (source[i] === '\n') line += 1;
  }
  return line;
}

export function extractBlocks(template) {
  const markers = [...template.matchAll(/___[A-Z0-9_]+___/g)].map((match) => ({
    marker: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }));

  const blocks = {};
  const errors = [];

  for (const expected of EXPECTED_BLOCKS) {
    const marker = markers.find((item) => item.marker === expected);
    if (!marker) {
      errors.push(issue(expected, 'Missing block'));
      continue;
    }

    const next = markers.find((item) => item.start > marker.start);
    const raw = template.slice(marker.end, next ? next.start : template.length);
    const leading = raw.length - raw.trimStart().length;
    const content = raw.trim();
    const startLine = lineAt(template, marker.end + leading);

    if (!content && expected !== BLOCKS.NOTES) {
      errors.push(issue(expected, 'Block is empty', startLine));
      continue;
    }

    blocks[expected] = { content, startLine };
  }

  return { blocks, errors };
}

export function validateTemplate(template) {
  const errors = [];
  const warnings = [];
  const { blocks, errors: blockErrors } = extractBlocks(template);
  errors.push(...blockErrors);

  if (blocks[BLOCKS.INFO]) {
    errors.push(...validateInfo(blocks[BLOCKS.INFO]));
  }

  if (blocks[BLOCKS.PARAMETERS]) {
    errors.push(...validateParameters(blocks[BLOCKS.PARAMETERS]));
  }

  let requirements = [];
  if (blocks[BLOCKS.CODE]) {
    const analysis = analyzeCode(blocks[BLOCKS.CODE].content, blocks[BLOCKS.CODE].startLine);
    requirements = analysis.requirements;
    for (const warning of analysis.warnings) {
      warnings.push(issue(BLOCKS.CODE, warning.message, warning.line, { api: warning.api }));
    }
  }

  if (blocks[BLOCKS.PERMISSIONS]) {
    let permissions;
    try {
      permissions = decodePermissions(JSON.parse(blocks[BLOCKS.PERMISSIONS].content));
    } catch (error) {
      errors.push(issue(BLOCKS.PERMISSIONS, `Invalid JSON: ${error.message}`, blocks[BLOCKS.PERMISSIONS].startLine));
    }

    if (permissions) {
      const result = validatePermissions(permissions, requirements);
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
  }

  return {
    errors,
    warnings,
    summary: {
      errors: errors.length,
      warnings: warnings.length,
    },
  };
}

function validateObject(obj, schema) {
  const validateField = (value, fieldSchema) => {
    if (fieldSchema.required && value === undefined) {
      return `${fieldSchema.name} is required.`;
    }

    if (value === undefined) return null;

    switch (fieldSchema.type) {
      case 'string':
        return typeof value === 'string' ? null : `${fieldSchema.name} must be a string.`;
      case 'int':
        return Number.isInteger(value) ? null : `${fieldSchema.name} must be an integer.`;
      case 'boolean':
      case 'bool':
        return typeof value === 'boolean' ? null : `${fieldSchema.name} must be a boolean.`;
      case 'simple_array':
        if (!Array.isArray(value)) return `${fieldSchema.name} must be an array.`;
        for (const item of value) {
          const error = validateField(item, fieldSchema.child_schema);
          if (error) return error;
        }
        return null;
      case 'array':
        if (!Array.isArray(value)) return `${fieldSchema.name} must be an array.`;
        for (const item of value) {
          for (const childField of fieldSchema.child_schema) {
            const error = validateField(item[childField.name], childField);
            if (error) return error;
          }
        }
        return null;
      case 'object': {
        const conclusion = validateObject(value, fieldSchema.child_schema);
        return conclusion.valid ? null : conclusion.error;
      }
      default:
        return `Unknown type for ${fieldSchema.name}.`;
    }
  };

  if (!obj || typeof obj !== 'object') {
    return { valid: false, error: 'Value must be an object.' };
  }

  for (const field of schema) {
    const error = validateField(obj[field.name], field);
    if (error) return { valid: false, error, field };
  }

  return { valid: true };
}

function validateInfo(block) {
  let json;
  try {
    json = JSON.parse(block.content);
  } catch (error) {
    return [issue(BLOCKS.INFO, `Invalid JSON: ${error.message}`, block.startLine)];
  }

  const conclusion = validateObject(json, [
    { name: 'type', required: true, type: 'string' },
    { name: 'id', required: true, type: 'string' },
    { name: 'version', required: true, type: 'int' },
    { name: 'securityGroups', required: true, type: 'simple_array', child_schema: { type: 'string' } },
    { name: 'displayName', required: true, type: 'string' },
    { name: 'categories', required: true, type: 'simple_array', child_schema: { type: 'string' } },
    {
      name: 'brand',
      required: true,
      type: 'object',
      child_schema: [
        { name: 'id', required: true, type: 'string' },
        { name: 'displayName', required: true, type: 'string' },
        { name: 'thumbnail', required: true, type: 'string' },
      ],
    },
    { name: 'description', required: true, type: 'string' },
    {
      name: 'containerContexts',
      required: true,
      type: 'simple_array',
      child_schema: { type: 'string' },
    },
  ]);

  return conclusion.valid
    ? []
    : [issue(BLOCKS.INFO, conclusion.error, block.startLine)];
}

function validateParameters(block) {
  try {
    const json = JSON.parse(block.content);
    if (!Array.isArray(json)) {
      return [issue(BLOCKS.PARAMETERS, 'Template parameters must be an array', block.startLine)];
    }
  } catch (error) {
    return [issue(BLOCKS.PARAMETERS, `Invalid JSON: ${error.message}`, block.startLine)];
  }

  return [];
}

function groupById(permissions) {
  const grouped = new Map();
  for (const permission of permissions) {
    if (!permission.publicId) continue;
    if (!grouped.has(permission.publicId)) grouped.set(permission.publicId, []);
    grouped.get(permission.publicId).push(permission);
  }
  return grouped;
}

function paramsFor(grouped, publicId) {
  return (grouped.get(publicId) || []).map((permission) => permission.params || {});
}

function collectKeys(grouped, publicId, paramName) {
  return paramsFor(grouped, publicId)
    .flatMap((params) => (Array.isArray(params[paramName]) ? params[paramName] : []))
    .filter((entry) => entry && typeof entry === 'object');
}

function unique(values) {
  return [...new Set(values)];
}

function isKeyUsed(declaredKey, usedKeys) {
  for (const used of usedKeys) {
    if (used === declaredKey || used.startsWith(`${declaredKey}.`)) return true;
  }
  return false;
}

function urlIsAllowed(url, allowedUrls) {
  if (allowedUrls === 'any') return 'any';
  const list = Array.isArray(allowedUrls) ? allowedUrls : [allowedUrls].filter(Boolean);
  return list.find((allowed) => url === allowed || url.startsWith(allowed)) || null;
}

function validatePermissions(permissions, requirements) {
  const errors = [];
  const warnings = [];
  const grouped = groupById(permissions);
  const requiredIds = unique(requirements.map((requirement) => requirement.permission));

  for (const publicId of requiredIds) {
    if (!grouped.has(publicId)) {
      errors.push(issue(
        BLOCKS.PERMISSIONS,
        `Permission "${publicId}" is used but not requested`,
      ));
    }
  }

  const dynamicSeen = new Set();
  for (const requirement of requirements) {
    if (!requirement.dynamic) continue;
    if (isDynamicAcceptable(requirement, grouped)) continue;
    if (!grouped.has(requirement.permission)) continue;

    const key = `${requirement.permission}|${requirement.api}`;
    if (dynamicSeen.has(key)) continue;
    dynamicSeen.add(key);

    warnings.push(issue(
      BLOCKS.PERMISSIONS,
      `Could not statically resolve the ${requirement.api} resource; skipped verification`,
      requirement.line,
      { permission: requirement.permission },
    ));
  }

  validateGlobals(grouped, requirements, errors, warnings);
  validateStorage(grouped, requirements, errors, warnings);
  validateCookies(grouped, requirements, errors, warnings);
  validateScripts(grouped, requirements, errors, warnings);
  validateIframes(grouped, requirements, errors, warnings);
  validateSendPixelUrls(grouped, requirements, errors, warnings);
  validateUrls(grouped, requirements, warnings);

  return { errors, warnings };
}

function isDynamicAcceptable(requirement, grouped) {
  if (!grouped.has(requirement.permission)) return true;

  if (requirement.permission === 'send_pixel') {
    return paramsFor(grouped, 'send_pixel')[0]?.allowedUrls === 'any';
  }
  if (requirement.permission === 'inject_hidden_iframe') {
    return paramsFor(grouped, 'inject_hidden_iframe')[0]?.urls === 'any';
  }
  if (requirement.permission === 'get_url' || requirement.permission === 'get_referrer') {
    const params = paramsFor(grouped, requirement.permission)[0] || {};
    if (requirement.kind === 'urlPart') return params.urlParts === 'any';
    if (requirement.kind === 'query') return params.queriesAllowed === 'any';
  }

  return false;
}

function validateGlobals(grouped, requirements, errors, warnings) {
  if (!grouped.has('access_globals')) return;

  const keys = collectKeys(grouped, 'access_globals', 'keys');
  const used = new Set();
  let hasDynamic = false;

  for (const requirement of requirements) {
    if (requirement.kind !== 'global') continue;
    if (requirement.dynamic) {
      hasDynamic = true;
      continue;
    }

    used.add(requirement.key);
    const entry = keys.find((item) => item.key === requirement.key);

    if (!entry) {
      errors.push(issue(
        BLOCKS.PERMISSIONS,
        `Key "${requirement.key}" is used but not declared in access_globals`,
        requirement.line,
      ));
      continue;
    }

    for (const flag of requirement.flags) {
      if (entry[flag] !== true) {
        errors.push(issue(
          BLOCKS.PERMISSIONS,
          `Key "${requirement.key}" must allow ${flag}=true in access_globals`,
          requirement.line,
        ));
      }
    }
  }

  if (hasDynamic) return;

  for (const entry of keys) {
    if (!isKeyUsed(entry.key, used)) {
      warnings.push(issue(
        BLOCKS.PERMISSIONS,
        `Key "${entry.key}" is declared in access_globals but never used`,
      ));
    }
  }
}

function validateStorage(grouped, requirements, errors, warnings) {
  if (!grouped.has('access_local_storage')) return;

  const keys = collectKeys(grouped, 'access_local_storage', 'keys');
  const used = new Set();
  let hasDynamic = false;

  for (const requirement of requirements) {
    if (requirement.kind !== 'storage') continue;
    if (requirement.dynamic) {
      hasDynamic = true;
      continue;
    }

    used.add(requirement.key);
    const entry = keys.find((item) => item.key === requirement.key);

    if (!entry) {
      errors.push(issue(
        BLOCKS.PERMISSIONS,
        `Local storage key "${requirement.key}" is used but not declared`,
        requirement.line,
      ));
      continue;
    }

    for (const flag of requirement.flags) {
      if (entry[flag] !== true) {
        errors.push(issue(
          BLOCKS.PERMISSIONS,
          `Local storage key "${requirement.key}" must allow ${flag}=true`,
          requirement.line,
        ));
      }
    }
  }

  if (hasDynamic) return;

  for (const entry of keys) {
    if (!used.has(entry.key)) {
      warnings.push(issue(
        BLOCKS.PERMISSIONS,
        `Local storage key "${entry.key}" is declared but never used`,
      ));
    }
  }
}

function validateCookies(grouped, requirements, errors, warnings) {
  if (grouped.has('get_cookies')) {
    const params = paramsFor(grouped, 'get_cookies');
    const access = params.some((item) => item.cookieAccess === 'all') ? 'all' : 'specific';
    const names = unique(params.flatMap((item) => item.cookieNames || []));
    const used = new Set();
    let hasDynamic = false;

    for (const requirement of requirements) {
      if (requirement.kind !== 'cookieRead') continue;
      if (requirement.dynamic) {
        hasDynamic = true;
        continue;
      }

      used.add(requirement.cookie);
      if (access !== 'all' && !names.includes(requirement.cookie)) {
        errors.push(issue(
          BLOCKS.PERMISSIONS,
          `Cookie "${requirement.cookie}" is read but not allowed in get_cookies`,
          requirement.line,
        ));
      }
    }

    if (!hasDynamic && access !== 'all') {
      for (const name of names) {
        if (!used.has(name)) {
          warnings.push(issue(BLOCKS.PERMISSIONS, `Cookie "${name}" is declared in get_cookies but never read`));
        }
      }
    }
  }

  if (grouped.has('set_cookies')) {
    const entries = collectKeys(grouped, 'set_cookies', 'allowedCookies');
    const names = unique(entries.map((entry) => entry.name).filter(Boolean));
    const used = new Set();
    let hasDynamic = false;

    for (const requirement of requirements) {
      if (requirement.kind !== 'cookieWrite') continue;
      if (requirement.dynamic) {
        hasDynamic = true;
        continue;
      }

      used.add(requirement.cookie);
      if (!names.includes(requirement.cookie)) {
        errors.push(issue(
          BLOCKS.PERMISSIONS,
          `Cookie "${requirement.cookie}" is written but not allowed in set_cookies`,
          requirement.line,
        ));
      }
    }

    if (!hasDynamic) {
      for (const name of names) {
        if (!used.has(name)) {
          warnings.push(issue(BLOCKS.PERMISSIONS, `Cookie "${name}" is declared in set_cookies but never written`));
        }
      }
    }
  }
}

function validateScripts(grouped, requirements, errors, warnings) {
  if (!grouped.has('inject_script')) return;

  const urls = unique(paramsFor(grouped, 'inject_script').flatMap((params) => params.urls || []));
  const used = new Set();
  let hasDynamic = false;

  for (const requirement of requirements) {
    if (requirement.kind !== 'script') continue;
    if (requirement.dynamic) {
      hasDynamic = true;
      continue;
    }

    const match = urlIsAllowed(requirement.url, urls);
    if (!match) {
      errors.push(issue(
        BLOCKS.PERMISSIONS,
        `Script "${requirement.url}" is loaded but not allowed in inject_script`,
        requirement.line,
      ));
    } else if (match !== 'any') {
      used.add(match);
    }
  }

  if (hasDynamic) return;

  for (const url of urls) {
    if (!used.has(url)) {
      warnings.push(issue(BLOCKS.PERMISSIONS, `Script URL "${url}" is declared in inject_script but never used`));
    }
  }
}

function validateIframes(grouped, requirements, errors, warnings) {
  if (!grouped.has('inject_hidden_iframe')) return;

  const urls = unique(paramsFor(grouped, 'inject_hidden_iframe').flatMap((params) => params.urls || []));
  const used = new Set();
  let hasDynamic = false;

  for (const requirement of requirements) {
    if (requirement.kind !== 'iframe') continue;
    if (requirement.dynamic) {
      hasDynamic = true;
      continue;
    }

    const match = urlIsAllowed(requirement.url, urls);
    if (!match) {
      errors.push(issue(
        BLOCKS.PERMISSIONS,
        `Iframe "${requirement.url}" is loaded but not allowed in inject_hidden_iframe`,
        requirement.line,
      ));
    } else if (match !== 'any') {
      used.add(match);
    }
  }

  if (hasDynamic) return;

  for (const url of urls) {
    if (!used.has(url)) {
      warnings.push(issue(BLOCKS.PERMISSIONS, `Iframe URL "${url}" is declared but never used`));
    }
  }
}

function validateSendPixelUrls(grouped, requirements, errors, warnings) {
  if (!grouped.has('send_pixel')) return;

  const allowedUrls = paramsFor(grouped, 'send_pixel')[0]?.allowedUrls;

  for (const requirement of requirements) {
    if (requirement.kind !== 'sendPixelUrl' || requirement.dynamic) continue;

    const match = urlIsAllowed(requirement.url, allowedUrls);
    if (!match) {
      errors.push(issue(
        BLOCKS.PERMISSIONS,
        `sendPixel URL "${requirement.url}" is not allowed`,
        requirement.line,
      ));
    }
  }
}

function validateUrls(grouped, requirements, warnings) {
  for (const [publicId, kind] of [['get_url', 'urlPart'], ['get_referrer', 'urlPart']]) {
    if (!grouped.has(publicId)) continue;
    const params = paramsFor(grouped, publicId)[0] || {};

    for (const requirement of requirements) {
      if (requirement.permission !== publicId || requirement.kind !== 'urlPart') continue;
      if (requirement.dynamic) continue;

      const declared = params.urlParts;
      if (declared === 'any') continue;
      if (Array.isArray(declared) ? declared.includes(requirement.part) : declared === requirement.part) continue;

      warnings.push(issue(
        BLOCKS.PERMISSIONS,
        `${publicId} declares urlParts "${declared}" but "${requirement.part}" is used; verify manually`,
        requirement.line,
      ));
    }
  }

  for (const publicId of ['get_url', 'get_referrer']) {
    if (!grouped.has(publicId)) continue;
    const params = paramsFor(grouped, publicId)[0] || {};

    for (const requirement of requirements) {
      if (requirement.permission !== publicId || requirement.kind !== 'query') continue;
      if (requirement.dynamic) continue;

      const declared = params.queriesAllowed;
      if (declared === 'any') continue;
      if (requirement.queryName === null) continue;
      if (Array.isArray(declared) ? declared.includes(requirement.queryName) : declared === requirement.queryName) {
        continue;
      }

      warnings.push(issue(
        BLOCKS.PERMISSIONS,
        `${publicId} declares queriesAllowed "${declared}" but query "${requirement.queryName}" is read; verify manually`,
        requirement.line,
      ));
    }
  }
}

export { PERMISSION_LABELS };
