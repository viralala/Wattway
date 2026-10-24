/**
 * Jest transform for PGlite's CommonJS build.
 *
 * PGlite's bundle uses dynamic `import("module")` / `import("fs/promises")` for
 * Node built-ins, which Jest's CommonJS sandbox only allows under
 * `node --experimental-vm-modules`. Built-ins can be required synchronously, so
 * rewrite those calls and the suite runs under a plain `jest` invocation.
 */
module.exports = {
  process(source) {
    const code = source.replace(
      /\bimport\((["'])((?:node:)?[a-z_/]+)\1\)/g,
      (_match, _quote, id) => `Promise.resolve().then(() => __jestRequire("${id}"))`,
    );
    // PGlite declares its own `var require` further down, so keep a handle on Jest's.
    return { code: `const __jestRequire = module.require.bind(module);
${code}` };
  },
};
