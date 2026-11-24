/**
 * Sandbox API -> web permission mapping.
 *
 * The validator uses this to discover which permissions a template needs. APIs
 * that need a specific resource (a global key, cookie name, script URL, ...)
 * are handled explicitly in static-analysis.js.
 */
export const API_PERMISSIONS = {
  // Consent
  addConsentListener: 'access_consent',
  isConsentGranted: 'access_consent',
  setDefaultConsentState: 'access_consent',
  updateConsentState: 'access_consent',

  // Data layer / container metadata
  addEventCallback: 'read_event_metadata',
  copyFromDataLayer: 'read_data_layer',
  gtagSet: 'write_data_layer',
  getContainerVersion: 'read_container_data',

  // Globals
  aliasInWindow: 'access_globals',
  callInWindow: 'access_globals',
  copyFromWindow: 'access_globals',
  createArgumentsQueue: 'access_globals',
  createQueue: 'access_globals',
  setInWindow: 'access_globals',

  // Cookies
  getCookieValues: 'get_cookies',
  setCookie: 'set_cookies',

  // URL / page information
  getQueryParameters: 'get_url',
  getReferrerQueryParameters: 'get_referrer',
  getReferrerUrl: 'get_referrer',
  getUrl: 'get_url',
  readAnalyticsStorage: 'read_analytics_storage',
  readCharacterSet: 'read_character_set',
  readTitle: 'read_title',

  // Scripts / network
  injectHiddenIframe: 'inject_hidden_iframe',
  injectScript: 'inject_script',
  sendPixel: 'send_pixel',

  // Storage / logging
  localStorage: 'access_local_storage',
  templateStorage: 'access_template_storage',
  logToConsole: 'logging',
};

/**
 * Documented sandbox APIs that do not require any web permission. Listing them
 * lets the validator distinguish a valid no-permission API from a typo or an
 * API that is newer than this map.
 */
export const APIS_WITHOUT_PERMISSION = new Set([
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
]);

export const KNOWN_APIS = new Set([
  ...Object.keys(API_PERMISSIONS),
  ...APIS_WITHOUT_PERMISSION,
]);

export const PERMISSION_LABELS = {
  access_globals: 'Global variables',
  inject_script: 'Injected scripts',
  inject_hidden_iframe: 'Injected iframes',
  get_cookies: 'Read cookies',
  set_cookies: 'Write cookies',
  get_url: 'Current URL',
  get_referrer: 'Referrer URL',
  send_pixel: 'Pixel requests',
  access_template_storage: 'Template storage',
  access_local_storage: 'Local storage',
  logging: 'Logging',
  read_title: 'Page title',
  read_data_layer: 'Data layer reads',
  write_data_layer: 'Data layer writes',
  access_consent: 'Consent state',
  read_container_data: 'Container metadata',
  read_analytics_storage: 'Analytics storage',
  read_character_set: 'Character set',
  read_event_metadata: 'Event metadata',
};

export const PERMISSION_DOCS = {
  access_globals: 'https://developers.google.com/tag-platform/tag-manager/templates/api#access_globals',
  inject_script: 'https://developers.google.com/tag-platform/tag-manager/templates/api#inject_script',
  get_cookies: 'https://developers.google.com/tag-platform/tag-manager/templates/api#get_cookies',
  set_cookies: 'https://developers.google.com/tag-platform/tag-manager/templates/api#set_cookies',
  get_url: 'https://developers.google.com/tag-platform/tag-manager/templates/api#get_url',
  get_referrer: 'https://developers.google.com/tag-platform/tag-manager/templates/api#get_referrer',
  send_pixel: 'https://developers.google.com/tag-platform/tag-manager/templates/api#send_pixel',
  access_local_storage: 'https://developers.google.com/tag-platform/tag-manager/templates/api#access_local_storage',
  access_template_storage: 'https://developers.google.com/tag-platform/tag-manager/templates/api#access_template_storage',
  logging: 'https://developers.google.com/tag-platform/tag-manager/templates/api#logging',
  read_title: 'https://developers.google.com/tag-platform/tag-manager/templates/api#read_title',
};

/**
 * Permissions whose resources we can verify from the sandbox code.
 * Used to decide whether "declared but never used" warnings are meaningful.
 */
export const RESOURCE_CHECKED_PERMISSIONS = new Set([
  'access_globals',
  'access_local_storage',
  'get_cookies',
  'set_cookies',
  'inject_script',
  'inject_hidden_iframe',
  'send_pixel',
  'get_url',
  'get_referrer',
]);
