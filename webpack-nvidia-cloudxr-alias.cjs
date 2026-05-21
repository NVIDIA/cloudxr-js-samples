'use strict';
const path = require('path');

const SAFE_BASENAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

/**
 * The environment variable OVERRIDE_CLOUDXR_FILENAME allows overriding the CloudXR.js bundle name
 * for testing purposes; it should not be used in production.
 *
 * When unset or empty, returns `{}` so webpack does not add any alias for `@nvidia/cloudxr`.
 *
 */
function nvidiaCloudxrWebpackAlias(exampleDirname) {
  const raw = process.env.OVERRIDE_CLOUDXR_FILENAME;
  if (raw == null || String(raw).trim() === '') {
    return {};
  }

  const base = String(raw).trim().replace(/\.js$/i, '');
  if (!SAFE_BASENAME.test(base)) {
    throw new Error(
      `Invalid OVERRIDE_CLOUDXR_FILENAME (use a simple filename stem, e.g. cloudxr-server-mock): ${JSON.stringify(raw)}`
    );
  }

  let pkgJsonPath;
  try {
    pkgJsonPath = require.resolve('@nvidia/cloudxr/package.json', { paths: [exampleDirname] });
  } catch (e) {
    throw new Error(
      `OVERRIDE_CLOUDXR_FILENAME is set but @nvidia/cloudxr could not be resolved: ${e.message}`
    );
  }

  const pkg = require(pkgJsonPath);
  if (typeof pkg.main !== 'string' || pkg.main.trim() === '') {
    throw new Error(
      'OVERRIDE_CLOUDXR_FILENAME requires @nvidia/cloudxr to declare a non-empty string "main" in package.json'
    );
  }

  const defaultEntry = path.resolve(path.dirname(pkgJsonPath), pkg.main);
  const bundlePath = path.join(path.dirname(defaultEntry), `${base}.js`);
  const bundleFile = path.basename(bundlePath);

  console.warn(
    `[webpack] OVERRIDE_CLOUDXR_FILENAME is set (${base}): @nvidia/cloudxr resolves to bundle file "${bundleFile}" (same directory as the package default entry; not the default filename).`
  );

  return { '@nvidia/cloudxr': bundlePath };
}

module.exports = { nvidiaCloudxrWebpackAlias };
