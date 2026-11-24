import { API_PERMISSIONS } from './permissions-schema.js';

const MAX_VALUES = 50;

/**
 * Removes // and /* *\/ comments while preserving character offsets and line
 * breaks, so a call inside a comment is not mistaken for real code.
 */
export function stripComments(source) {
  let out = '';
  let state = null;
  let i = 0;

  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];

    if (state === 'line') {
      if (char === '\n') {
        state = null;
        out += char;
      } else {
        out += ' ';
      }
      i += 1;
      continue;
    }

    if (state === 'block') {
      if (char === '*' && next === '/') {
        out += '  ';
        i += 2;
        state = null;
      } else {
        out += char === '\n' ? '\n' : ' ';
        i += 1;
      }
      continue;
    }

    if (state === 'single' || state === 'double' || state === 'template') {
      out += char;
      if (char === '\\') {
        out += source[i + 1] || '';
        i += 2;
        continue;
      }
      if (
        (state === 'single' && char === "'") ||
        (state === 'double' && char === '"') ||
        (state === 'template' && char === '`')
      ) {
        state = null;
      }
      i += 1;
      continue;
    }

    if (char === '/' && next === '/') {
      state = 'line';
      out += '  ';
      i += 2;
      continue;
    }
    if (char === '/' && next === '*') {
      state = 'block';
      out += '  ';
      i += 2;
      continue;
    }
    if (char === "'") state = 'single';
    else if (char === '"') state = 'double';
    else if (char === '`') state = 'template';

    out += char;
    i += 1;
  }

  return out;
}

export function createLineLocator(source) {
  const starts = [0];
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === '\n') starts.push(i + 1);
  }

  return function lineAt(index) {
    let low = 0;
    let high = starts.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (starts[mid] <= index) low = mid + 1;
      else high = mid - 1;
    }
    return high + 1;
  };
}

function skipString(source, index) {
  const quote = source[index];
  let i = index + 1;
  while (i < source.length) {
    if (source[i] === '\\') {
      i += 2;
      continue;
    }
    if (source[i] === quote) return i + 1;
    i += 1;
  }
  return source.length;
}

function findMatching(source, openIndex, open, close) {
  let depth = 0;
  let i = openIndex;
  while (i < source.length) {
    const char = source[i];
    if (char === "'" || char === '"' || char === '`') {
      i = skipString(source, i);
      continue;
    }
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return -1;
}

export function parseArguments(source, openIndex) {
  const args = [];
  let start = openIndex + 1;
  let parens = 1;
  let brackets = 0;
  let braces = 0;
  let i = openIndex + 1;

  while (i < source.length) {
    const char = source[i];

    if (char === "'" || char === '"' || char === '`') {
      i = skipString(source, i);
      continue;
    }

    if (char === '(') parens += 1;
    else if (char === ')') {
      parens -= 1;
      if (parens === 0) {
        const tail = source.slice(start, i).trim();
        if (tail || args.length > 0) args.push(tail);
        return args;
      }
    } else if (char === '[') brackets += 1;
    else if (char === ']') brackets -= 1;
    else if (char === '{') braces += 1;
    else if (char === '}') braces -= 1;
    else if (char === ',' && parens === 1 && brackets === 0 && braces === 0) {
      args.push(source.slice(start, i).trim());
      start = i + 1;
    }

    i += 1;
  }

  return args;
}

function splitTopLevel(source, separator) {
  const parts = [];
  let start = 0;
  let parens = 0;
  let brackets = 0;
  let braces = 0;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === "'" || char === '"' || char === '`') {
      i = skipString(source, i) - 1;
      continue;
    }
    if (char === '(') parens += 1;
    else if (char === ')') parens -= 1;
    else if (char === '[') brackets += 1;
    else if (char === ']') brackets -= 1;
    else if (char === '{') braces += 1;
    else if (char === '}') braces -= 1;
    else if (
      char === separator &&
      parens === 0 &&
      brackets === 0 &&
      braces === 0
    ) {
      parts.push(source.slice(start, i));
      start = i + 1;
    }
  }

  parts.push(source.slice(start));
  return parts;
}

function stripOuterParens(source) {
  let value = source.trim();
  while (value.startsWith('(')) {
    const close = findMatching(value, 0, '(', ')');
    if (close !== value.length - 1) break;
    value = value.slice(1, -1).trim();
  }
  return value;
}

function parseStringLiteral(source) {
  const quote = source[0];
  if (quote !== "'" && quote !== '"') return null;
  if (source[source.length - 1] !== quote) return null;

  const body = source.slice(1, -1);
  let out = '';
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] !== '\\') {
      out += body[i];
      continue;
    }

    const escaped = body[i + 1];
    i += 1;
    switch (escaped) {
      case 'n': out += '\n'; break;
      case 'r': out += '\r'; break;
      case 't': out += '\t'; break;
      case 'b': out += '\b'; break;
      case 'f': out += '\f'; break;
      case 'v': out += '\v'; break;
      case '0': out += '\0'; break;
      case 'x': {
        const hex = body.slice(i + 1, i + 3);
        if (/^[0-9a-fA-F]{2}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          i += 2;
        } else {
          out += 'x';
        }
        break;
      }
      case 'u': {
        const hex = body.slice(i + 1, i + 5);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          i += 4;
        } else {
          out += 'u';
        }
        break;
      }
      default:
        out += escaped === undefined ? '' : escaped;
    }
  }
  return out;
}

function cartesian(left, right) {
  if (left.length * right.length > MAX_VALUES) return null;
  const out = [];
  for (const a of left) {
    for (const b of right) out.push(String(a) + String(b));
  }
  return out;
}

/**
 * Resolves an expression to every statically-known string value it can have.
 * Returns null when the value cannot be determined.
 */
export function resolveExpression(expression, context) {
  if (!expression) return null;

  const source = stripOuterParens(expression);
  if (!source) return null;

  if (source[0] === '`' && skipString(source, 0) === source.length) {
    return resolveTemplateLiteral(source, context);
  }

  if (source[0] === "'" || source[0] === '"') {
    if (skipString(source, 0) !== source.length) {
      // Not a single literal (e.g. 'a' + 'b'); fall through to concatenation.
    } else {
      const value = parseStringLiteral(source);
      return value === null ? null : [value];
    }
  }

  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(source)) {
    return [String(Number(source))];
  }

  if (source === 'true' || source === 'false') {
    return [source];
  }

  if (/^[A-Za-z_$][\w$]*$/.test(source)) {
    const scope = context.scope;
    if (scope) {
      const paramIndex = scope.params.indexOf(source);
      if (paramIndex !== -1) {
        const values = scope.paramValues[paramIndex];
        return values && values.size > 0 ? [...values] : null;
      }
      if (scope.constants && scope.constants.has(source)) {
        return [scope.constants.get(source)];
      }
    }
    if (context.constants.has(source)) {
      return [context.constants.get(source)];
    }
    return null;
  }

  const parts = splitTopLevel(source, '+');
  if (parts.length > 1) {
    let values = [''];
    for (const part of parts) {
      const resolved = resolveExpression(part, context);
      if (!resolved) return null;
      values = cartesian(values, resolved);
      if (!values) return null;
    }
    return values;
  }

  return null;
}

function resolveTemplateLiteral(source, context) {
  const inner = source.slice(1, -1);
  let values = [''];
  let literal = '';
  let i = 0;

  while (i < inner.length) {
    if (inner[i] === '\\') {
      literal += inner[i + 1] || '';
      i += 2;
      continue;
    }

    if (inner[i] === '$' && inner[i + 1] === '{') {
      const end = findMatching(inner, i + 1, '{', '}');
      if (end === -1) return null;

      values = cartesian(values, [literal]);
      if (!values) return null;
      literal = '';

      const resolved = resolveExpression(inner.slice(i + 2, end), context);
      if (!resolved) return null;
      values = cartesian(values, resolved);
      if (!values) return null;

      i = end + 1;
      continue;
    }

    literal += inner[i];
    i += 1;
  }

  return cartesian(values, [literal]);
}

function collectConstants(source, scopes) {
  const globalConstants = new Map();
  const assignment = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)/g;
  const matches = [...source.matchAll(assignment)].map((match) => ({
    name: match[1],
    expression: match[2].trim(),
    index: match.index,
  }));

  for (let pass = 0; pass < 5; pass += 1) {
    let changed = false;
    for (const match of matches) {
      const scope = getScopeAt(match.index, scopes);
      const target = scope ? scope.constants : globalConstants;
      if (target.has(match.name)) continue;

      const resolved = resolveExpression(match.expression, {
        constants: globalConstants,
        scope,
      });
      if (resolved && resolved.length === 1) {
        target.set(match.name, resolved[0]);
        changed = true;
      }
    }
    if (!changed) break;
  }

  return globalConstants;
}

function findFunctionScopes(source) {
  const scopes = [];
  const definition = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/g;
  let match;

  while ((match = definition.exec(source)) !== null) {
    const bodyStart = match.index + match[0].length - 1;
    const bodyEnd = findMatching(source, bodyStart, '{', '}');
    if (bodyEnd === -1) continue;

    const params = splitTopLevel(match[2], ',').map((part) => part.trim()).filter(Boolean);
    scopes.push({
      name: match[1],
      params,
      bodyStart,
      bodyEnd,
      paramValues: params.map(() => new Set()),
      constants: new Map(),
    });
  }

  return scopes;
}

function getScopeAt(index, scopes) {
  let found = null;
  for (const scope of scopes) {
    if (index > scope.bodyStart && index < scope.bodyEnd) {
      if (!found || scope.bodyEnd - scope.bodyStart < found.bodyEnd - found.bodyStart) {
        found = scope;
      }
    }
  }
  return found;
}

function collectParamValues(source, scopes, constants) {
  for (let pass = 0; pass < 3; pass += 1) {
    let changed = false;

    for (const scope of scopes) {
      const call = new RegExp(`\\b${scope.name}\\s*\\(`, 'g');
      let match;
      while ((match = call.exec(source)) !== null) {
        const before = source.slice(Math.max(0, match.index - 20), match.index);
        if (/\bfunction\s+$/.test(before)) continue;

        const openIndex = match.index + match[0].length - 1;
        const args = parseArguments(source, openIndex);
        const callScope = getScopeAt(match.index, scopes);

        scope.params.forEach((param, paramIndex) => {
          const argument = args[paramIndex];
          if (argument === undefined) return;
          const resolved = resolveExpression(argument, { constants, scope: callScope });
          if (!resolved) return;
          for (const value of resolved) {
            if (!scope.paramValues[paramIndex].has(value)) {
              scope.paramValues[paramIndex].add(value);
              changed = true;
            }
          }
        });
      }
    }

    if (!changed) break;
  }
}

function addPresence(requirements, permission, api, line) {
  if (!permission) return;
  requirements.push({ permission, kind: 'presence', api, line });
}

function addGlobal(requirements, api, keyExpression, flags, context, line) {
  const resolved = keyExpression === undefined ? null : resolveExpression(keyExpression, context);
  if (!resolved) {
    requirements.push({ permission: 'access_globals', kind: 'global', api, flags, dynamic: true, line });
    return;
  }
  for (const key of resolved) {
    requirements.push({ permission: 'access_globals', kind: 'global', api, key, flags, line });
  }
}

function addCookie(requirements, permission, kind, api, expression, context, line) {
  const resolved = resolveExpression(expression, context);
  if (!resolved) {
    requirements.push({ permission, kind, api, dynamic: true, line });
    return;
  }
  for (const cookie of resolved) {
    requirements.push({ permission, kind, api, cookie, line });
  }
}

function addUrl(requirements, permission, kind, api, expression, context, line) {
  const resolved = expression === undefined || expression === '' ? null : resolveExpression(expression, context);
  if (!resolved) {
    requirements.push({ permission, kind, api, dynamic: true, line });
    return;
  }
  for (const url of resolved) {
    requirements.push({ permission, kind, api, url, line });
  }
}

function addUrlPart(requirements, permission, api, expression, context, line) {
  const resolved = expression === undefined || expression === '' ? ['any'] : resolveExpression(expression, context);
  if (!resolved) {
    requirements.push({ permission, kind: 'urlPart', api, dynamic: true, line });
    return;
  }
  for (const part of resolved) {
    requirements.push({ permission, kind: 'urlPart', api, part, line });
  }
}

function addQuery(requirements, permission, api, expression, context, line) {
  const resolved = expression === undefined || expression === '' ? [null] : resolveExpression(expression, context);
  if (!resolved) {
    requirements.push({ permission, kind: 'query', api, dynamic: true, line });
    return;
  }
  for (const queryName of resolved) {
    requirements.push({ permission, kind: 'query', api, queryName, line });
  }
}

function addStorage(requirements, api, keyExpression, flag, context, line) {
  const resolved = keyExpression === undefined ? null : resolveExpression(keyExpression, context);
  if (!resolved) {
    requirements.push({ permission: 'access_local_storage', kind: 'storage', api, flags: [flag], dynamic: true, line });
    return;
  }
  for (const key of resolved) {
    requirements.push({ permission: 'access_local_storage', kind: 'storage', api, key, flags: [flag], line });
  }
}

export function analyzeCode(code, baseLine = 1) {
  const lineAt = createLineLocator(code);
  const source = stripComments(code);
  const scopes = findFunctionScopes(source);
  const constants = collectConstants(source, scopes);
  collectParamValues(source, scopes, constants);

  const requirements = [];

  // Presence requirements come from require() as well as from actual calls.
  const requires = [...source.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)];
  for (const match of requires) {
    const api = match[1];
    addPresence(
      requirements,
      API_PERMISSIONS[api],
      `require:${api}`,
      baseLine + lineAt(match.index) - 1,
    );
  }

  const apiNames = Object.keys(API_PERMISSIONS).concat('localStorage');
  const callPattern = new RegExp(
    `\\b(${apiNames.join('|')})\\s*(?:\\.\\s*(getItem|setItem|removeItem)\\s*)?\\(`,
    'g',
  );

  let match;
  while ((match = callPattern.exec(source)) !== null) {
    const api = match[1];
    const method = match[2];
    const line = baseLine + lineAt(match.index) - 1;
    const before = source.slice(Math.max(0, match.index - 20), match.index);
    if (/\bfunction\s+$/.test(before)) continue;

    const openIndex = match.index + match[0].length - 1;
    const args = parseArguments(source, openIndex);
    const context = { constants, scope: getScopeAt(match.index, scopes) };
    const permission = API_PERMISSIONS[api];

    addPresence(requirements, permission, api, line);

    switch (api) {
      case 'copyFromWindow':
        addGlobal(requirements, api, args[0], ['read'], context, line);
        break;
      case 'setInWindow':
        addGlobal(requirements, api, args[0], ['write'], context, line);
        break;
      case 'callInWindow':
        addGlobal(requirements, api, args[0], ['execute'], context, line);
        break;
      case 'aliasInWindow': {
        const aliases = resolveExpression(args[0], context);
        const sources = resolveExpression(args[1], context);
        if (!aliases || !sources) {
          requirements.push({
            permission: 'access_globals',
            kind: 'global',
            api,
            flags: ['write'],
            dynamic: true,
            line,
          });
          break;
        }
        for (const alias of aliases) {
          requirements.push({ permission: 'access_globals', kind: 'global', api, key: alias, flags: ['write'], line });
        }
        for (const globalName of sources) {
          requirements.push({ permission: 'access_globals', kind: 'global', api, key: globalName, flags: ['read'], line });
        }
        break;
      }
      case 'createQueue':
        addGlobal(requirements, api, args[0], ['read', 'write'], context, line);
        break;
      case 'createArgumentsQueue': {
        const queues = resolveExpression(args[0], context);
        const argumentQueues = resolveExpression(args[1], context);
        if (!queues || !argumentQueues) {
          requirements.push({
            permission: 'access_globals',
            kind: 'global',
            api,
            flags: ['read', 'write'],
            dynamic: true,
            line,
          });
          break;
        }
        for (const queue of queues) {
          requirements.push({ permission: 'access_globals', kind: 'global', api, key: queue, flags: ['read', 'write'], line });
        }
        for (const queue of argumentQueues) {
          requirements.push({ permission: 'access_globals', kind: 'global', api, key: queue, flags: ['read', 'write'], line });
        }
        break;
      }
      case 'getCookieValues':
        addCookie(requirements, 'get_cookies', 'cookieRead', api, args[0], context, line);
        break;
      case 'setCookie':
        addCookie(requirements, 'set_cookies', 'cookieWrite', api, args[0], context, line);
        break;
      case 'injectScript':
        addUrl(requirements, 'inject_script', 'script', api, args[0], context, line);
        break;
      case 'injectHiddenIframe':
        addUrl(requirements, 'inject_hidden_iframe', 'iframe', api, args[0], context, line);
        break;
      case 'sendPixel':
        addUrl(requirements, 'send_pixel', 'sendPixelUrl', api, args[0], context, line);
        break;
      case 'getUrl':
        addUrlPart(requirements, 'get_url', api, args[0], context, line);
        break;
      case 'getReferrerUrl':
        addUrlPart(requirements, 'get_referrer', api, args[0], context, line);
        break;
      case 'getQueryParameters':
        addQuery(requirements, 'get_url', api, args[0], context, line);
        break;
      case 'getReferrerQueryParameters':
        addQuery(requirements, 'get_referrer', api, args[0], context, line);
        break;
      case 'localStorage':
        if (method === 'getItem') addStorage(requirements, api, args[0], 'read', context, line);
        else if (method === 'setItem' || method === 'removeItem') {
          addStorage(requirements, api, args[0], 'write', context, line);
        }
        break;
      default:
        break;
    }
  }

  return {
    requirements: dedupeRequirements(requirements),
    constants,
    scopes,
  };
}

function dedupeRequirements(requirements) {
  const seen = new Set();
  const out = [];

  for (const requirement of requirements) {
    let key;
    if (requirement.kind === 'presence') {
      key = `${requirement.permission}|presence`;
    } else if (requirement.dynamic) {
      key = `${requirement.permission}|${requirement.kind}|${requirement.api}|dynamic`;
    } else if (requirement.kind === 'global' || requirement.kind === 'storage') {
      key = `${requirement.permission}|${requirement.kind}|${requirement.key}|${(requirement.flags || []).join(',')}`;
    } else if (requirement.kind === 'cookieRead' || requirement.kind === 'cookieWrite') {
      key = `${requirement.permission}|${requirement.kind}|${requirement.cookie}`;
    } else if (requirement.kind === 'script' || requirement.kind === 'iframe' || requirement.kind === 'sendPixelUrl') {
      key = `${requirement.permission}|${requirement.kind}|${requirement.url}`;
    } else if (requirement.kind === 'urlPart') {
      key = `${requirement.permission}|${requirement.kind}|${requirement.part}`;
    } else if (requirement.kind === 'query') {
      key = `${requirement.permission}|${requirement.kind}|${requirement.queryName}`;
    } else {
      key = JSON.stringify(requirement);
    }

    if (seen.has(key)) continue;
    seen.add(key);
    out.push(requirement);
  }

  return out;
}
