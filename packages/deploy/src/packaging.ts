/**
 * Everything needed to prepare a deploy, and nothing that performs one.
 *
 * A separate entry point because the CLI imports from here. The package's main
 * entry reaches Google, and reaching Google means `google-auth-library`, which
 * is a megabyte of dependency that would end up inside a single-file CLI whose
 * whole premise is that it has none. Splitting the import is what keeps that
 * true.
 *
 * The test that would catch a regression is the size of `bin/cira.js`.
 */

export * from "./archive.js";
export * from "./bundle.js";
export * from "./source-pack.js";
