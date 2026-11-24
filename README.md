# GTM Template validator

Sometimes, after publishing an update to your GTM tag template, it may not appear in the Community Template Gallery, or your entire template may have disappeared from the listing.

Template updates are automatic, which means these problems stem from errors in the template itself.

If your template has disappeared from the listing, it usually means that the `metadata.yaml` file is invalid.

If your latest update does not appear or changelog section has stopped appearing in in your template profile, there is something wrong with the `template.tpl` file.

Identifying the issue is not easy, as Google does not indicate what the problem is or provide tools to validate these files.

Importing your own tag into GTM helps detect basic errors, but not more complex ones. For example, if you fail to list the permissions your tag uses, Google automatically adds them when you import it, preventing you from identifying that type of error.

You can use it at: https://mjadsmurai.github.io/gtm-template-validator/

## What is validated

- Block structure and JSON syntax.
- `___INFO___` required fields.
- `___TEMPLATE_PARAMETERS___` JSON shape.
- `___TESTS___` YAML syntax and `scenarios[].name` / `scenarios[].code` shape.
- Permission **types** required by `require(...)` calls.
- The full documented GTM sandbox API list (both permission-bearing and no-permission APIs), so unknown `require()` names are reported as warnings.
- Permission **resources** used by the sandbox code:
  - `access_globals` keys and their `read` / `write` / `execute` flags.
  - `get_cookies` and `set_cookies` cookie names.
  - `inject_script` and `inject_hidden_iframe` URLs (exact or URL-prefix match).
  - `send_pixel` allowed URLs.
  - `access_local_storage` keys and flags.
  - `get_url` / `get_referrer` URL parts and query parameters.
- Unused permission resources are reported as warnings.

The static analyser resolves literals, `const` constants (including function-scoped ones) and simple wrapper functions, so calls like `injectProviderSDK(url)` or `setOrGetMicrosoftCookie('_uetuid', ...)` are checked too. Values that cannot be resolved statically produce a warning instead of a false error.

## Development

Tests use the Node.js built-in test runner. The YAML parser is vendored at `src/vendor/js-yaml.mjs` (MIT license included), so there is no runtime CDN dependency and no install step is required:

```bash
npm test
```

Layout:

```
index.html                  browser UI
src/gtm-value.js            GTM permission value codec
src/permissions-schema.js   sandbox API -> permission map
src/static-analysis.js      code scanning and constant resolution
src/validator.js            validation orchestration
src/vendor/js-yaml.js      vendored YAML parser (MIT)
src/vendor/js-yaml.LICENSE  parser license
test/validator.test.js      test suite
test/fixtures/official.tpl  reference template
```
