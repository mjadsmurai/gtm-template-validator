import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateTemplate } from '../src/validator.js';
import { encodePermission } from '../src/gtm-value.js';
import { API_PERMISSIONS, APIS_WITHOUT_PERMISSION } from '../src/permissions-schema.js';

const INFO = {
  type: 'TAG',
  id: 'test',
  version: 1,
  securityGroups: [],
  displayName: 'Test template',
  categories: ['ADVERTISING'],
  brand: { id: 'test', displayName: 'Test', thumbnail: 'data:image/png;base64,AA==' },
  description: 'Test',
  containerContexts: ['WEB'],
};

function buildTemplate({ code = 'data.gtmOnSuccess();', permissions = [], permissionsText } = {}) {
  return [
    '___TERMS_OF_SERVICE___',
    'terms',
    '___INFO___',
    JSON.stringify(INFO),
    '___TEMPLATE_PARAMETERS___',
    '[]',
    '___SANDBOXED_JS_FOR_WEB_TEMPLATE___',
    code,
    '___WEB_PERMISSIONS___',
    permissionsText === undefined ? JSON.stringify(permissions) : permissionsText,
    '___TESTS___',
    'scenarios: []',
    '___NOTES___',
    'notes',
    '',
  ].join('\n\n');
}

function errorText(result) {
  return result.errors.map((error) => error.message).join('\n');
}

function globalPermission(keys) {
  return encodePermission('access_globals', { keys });
}

test('official.tpl has no permission errors', () => {
  const template = fs.readFileSync(new URL('./fixtures/official.tpl', import.meta.url), 'utf8');
  const result = validateTemplate(template);

  assert.equal(result.errors.length, 0, errorText(result));
  assert.ok(
    result.warnings.some((warning) => warning.message.includes('adsmuraiSDK.fetch')),
    'expected the known unused global to be reported',
  );
  assert.ok(
    !result.warnings.some((warning) => warning.message.includes('injectScript')),
    'expected wrapper functions and constants to be resolved',
  );
});

test('reports a used global key that is not declared', () => {
  const result = validateTemplate(buildTemplate({
    code: "copyFromWindow('foo');",
    permissions: [globalPermission([])],
  }));

  assert.match(errorText(result), /Key "foo" is used but not declared/);
});

test('reports a missing access_globals flag', () => {
  const result = validateTemplate(buildTemplate({
    code: "callInWindow('foo');",
    permissions: [globalPermission([
      { key: 'foo', read: true, write: false, execute: false },
    ])],
  }));

  assert.match(errorText(result), /Key "foo" must allow execute=true/);
});

test('reports a read cookie that is not allowed', () => {
  const result = validateTemplate(buildTemplate({
    code: "getCookieValues('_ttp');",
    permissions: [encodePermission('get_cookies', {
      cookieAccess: 'specific',
      cookieNames: ['_fbp'],
    })],
  }));

  assert.match(errorText(result), /Cookie "_ttp" is read but not allowed/);
});

test('reports a written cookie that is not allowed', () => {
  const result = validateTemplate(buildTemplate({
    code: "setCookie('_le', 'x', {});",
    permissions: [encodePermission('set_cookies', {
      allowedCookies: [{ name: '_fbp', domain: '*', path: '*', secure: 'any', session: 'any' }],
    })],
  }));

  assert.match(errorText(result), /Cookie "_le" is written but not allowed/);
});

test('reports a script URL that is not allowed', () => {
  const result = validateTemplate(buildTemplate({
    code: "injectScript('https://a.example.com/x.js', data.gtmOnSuccess, data.gtmOnFailure);",
    permissions: [encodePermission('inject_script', { urls: ['https://b.example.com/'] })],
  }));

  assert.match(errorText(result), /Script "https:\/\/a\.example\.com\/x\.js" is loaded but not allowed/);
});

test('accepts an injected script that matches an allowed URL prefix', () => {
  const result = validateTemplate(buildTemplate({
    code: "injectScript('https://cdn.example.com/sdk.js?tv=8', data.gtmOnSuccess, data.gtmOnFailure);",
    permissions: [encodePermission('inject_script', { urls: ['https://cdn.example.com/'] })],
  }));

  assert.equal(result.errors.length, 0, errorText(result));
  assert.ok(!result.warnings.some((warning) => warning.message.includes('never used')));
});

test('reports a local storage key that is not declared', () => {
  const result = validateTemplate(buildTemplate({
    code: "localStorage.getItem('key');",
    permissions: [encodePermission('access_local_storage', { keys: [] })],
  }));

  assert.match(errorText(result), /Local storage key "key" is used but not declared/);
});

test('does not throw on malformed permission JSON', () => {
  const result = validateTemplate(buildTemplate({ permissionsText: 'not json' }));

  assert.match(errorText(result), /Invalid JSON/);
});

test('does not throw when a block is missing', () => {
  const template = buildTemplate().replace(/___WEB_PERMISSIONS___[\s\S]*?(?=___TESTS___)/, '');
  const result = validateTemplate(template);

  assert.match(errorText(result), /Missing block/);
});

test('warns instead of failing when a global key cannot be resolved', () => {
  const result = validateTemplate(buildTemplate({
    code: 'const name = windowName; copyFromWindow(name);',
    permissions: [globalPermission([])],
  }));

  assert.equal(result.errors.length, 0, errorText(result));
  assert.match(result.warnings.map((warning) => warning.message).join('\n'), /Could not statically resolve/);
});

test('warns about a declared global key that is never used', () => {
  const result = validateTemplate(buildTemplate({
    code: 'data.gtmOnSuccess();',
    permissions: [globalPermission([
      { key: 'unused', read: true, write: true, execute: false },
    ])],
  }));

  assert.match(result.warnings.map((warning) => warning.message).join('\n'), /Key "unused" is declared/);
});

test('checks both queues of createArgumentsQueue', () => {
  const result = validateTemplate(buildTemplate({
    code: "createArgumentsQueue('pintrk', 'pintrk.queue');",
    permissions: [globalPermission([
      { key: 'pintrk', read: true, write: true, execute: false },
    ])],
  }));

  assert.match(errorText(result), /Key "pintrk.queue" is used but not declared/);
});

test('accepts get_url when urlParts and queriesAllowed are any', () => {
  const result = validateTemplate(buildTemplate({
    code: "getQueryParameters('utm_source'); getUrl();",
    permissions: [encodePermission('get_url', { urlParts: 'any', queriesAllowed: 'any' })],
  }));

  assert.equal(result.errors.length, 0, errorText(result));
});

test('resolves wrapper function arguments for scripts', () => {
  const code = [
    'function load(url) {',
    '  injectScript(url, data.gtmOnSuccess, data.gtmOnFailure);',
    '}',
    "load('https://a.example.com/x.js');",
    "load('https://b.example.com/y.js');",
  ].join('\n');

  const result = validateTemplate(buildTemplate({
    code,
    permissions: [encodePermission('inject_script', {
      urls: ['https://a.example.com/', 'https://b.example.com/'],
    })],
  }));

  assert.equal(result.errors.length, 0, errorText(result));
  assert.ok(!result.warnings.some((warning) => warning.message.includes('never used')));
});

test('resolves function-scoped constants independently', () => {
  const code = [
    'function readOne() { const key = "one"; localStorage.getItem(key); }',
    'function writeTwo() { const key = "two"; localStorage.setItem(key, "x"); }',
    'readOne();',
    'writeTwo();',
  ].join('\n');

  const result = validateTemplate(buildTemplate({
    code,
    permissions: [encodePermission('access_local_storage', {
      keys: [
        { key: 'one', read: true, write: false },
        { key: 'two', read: false, write: true },
      ],
    })],
  }));

  assert.equal(result.errors.length, 0, errorText(result));
});

const DOCUMENTED_PERMISSION_APIS = {
  addConsentListener: 'access_consent',
  addEventCallback: 'read_event_metadata',
  aliasInWindow: 'access_globals',
  callInWindow: 'access_globals',
  copyFromDataLayer: 'read_data_layer',
  copyFromWindow: 'access_globals',
  createArgumentsQueue: 'access_globals',
  createQueue: 'access_globals',
  getContainerVersion: 'read_container_data',
  getCookieValues: 'get_cookies',
  getQueryParameters: 'get_url',
  getReferrerQueryParameters: 'get_referrer',
  getReferrerUrl: 'get_referrer',
  getUrl: 'get_url',
  gtagSet: 'write_data_layer',
  injectHiddenIframe: 'inject_hidden_iframe',
  injectScript: 'inject_script',
  isConsentGranted: 'access_consent',
  localStorage: 'access_local_storage',
  logToConsole: 'logging',
  readAnalyticsStorage: 'read_analytics_storage',
  readCharacterSet: 'read_character_set',
  readTitle: 'read_title',
  sendPixel: 'send_pixel',
  setCookie: 'set_cookies',
  setDefaultConsentState: 'access_consent',
  setInWindow: 'access_globals',
  templateStorage: 'access_template_storage',
  updateConsentState: 'access_consent',
};

const DOCUMENTED_NO_PERMISSION_APIS = [
  'callLater',
  'decodeUri',
  'decodeUriComponent',
  'encodeUri',
  'encodeUriComponent',
  'fromBase64',
  'generateRandom',
  'getTimestamp',
  'getTimestampMillis',
  'getType',
  'JSON',
  'makeInteger',
  'makeNumber',
  'makeString',
  'makeTableMap',
  'Math',
  'Object',
  'parseUrl',
  'queryPermission',
  'require',
  'sha256',
  'toBase64',
];

test('maps every documented sandbox API', () => {
  assert.deepEqual(Object.keys(API_PERMISSIONS).sort(), Object.keys(DOCUMENTED_PERMISSION_APIS).sort());

  for (const [api, permission] of Object.entries(DOCUMENTED_PERMISSION_APIS)) {
    assert.equal(API_PERMISSIONS[api], permission, api);
  }

  for (const api of DOCUMENTED_NO_PERMISSION_APIS) {
    assert.ok(APIS_WITHOUT_PERMISSION.has(api), `missing no-permission API ${api}`);
    assert.equal(API_PERMISSIONS[api], undefined, `${api} should not require a permission`);
  }
});

test('requires read_analytics_storage for readAnalyticsStorage', () => {
  const result = validateTemplate(buildTemplate({
    code: "const readAnalyticsStorage = require('readAnalyticsStorage'); readAnalyticsStorage();",
    permissions: [],
  }));

  assert.match(errorText(result), /Permission "read_analytics_storage" is used but not requested/);
});

test('accepts readAnalyticsStorage when read_analytics_storage is declared', () => {
  const result = validateTemplate(buildTemplate({
    code: "const readAnalyticsStorage = require('readAnalyticsStorage'); readAnalyticsStorage();",
    permissions: [encodePermission('read_analytics_storage', {})],
  }));

  assert.equal(result.errors.length, 0, errorText(result));
});

test('warns about an unknown require', () => {
  const result = validateTemplate(buildTemplate({
    code: "const future = require('futureApi');",
    permissions: [],
  }));

  assert.equal(result.errors.length, 0, errorText(result));
  assert.match(
    result.warnings.map((warning) => warning.message).join('\n'),
    /Unknown API "futureApi" in require/,
  );
});

test('does not warn for documented no-permission APIs', () => {
  const result = validateTemplate(buildTemplate({
    code: [
      "require('sha256');",
      "require('makeInteger');",
      "require('queryPermission');",
      "require('parseUrl');",
    ].join('\n'),
    permissions: [],
  }));

  assert.equal(result.errors.length, 0, errorText(result));
  assert.ok(!result.warnings.some((warning) => warning.message.includes('Unknown API')));
});
