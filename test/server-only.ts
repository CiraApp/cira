/**
 * Stands in for the `server-only` package when tests import a module that
 * guards itself with it. The real package throws at build time in a client
 * bundle; there is no bundle here, so there is nothing to guard.
 */
export {};
