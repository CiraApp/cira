/**
 * Variables a frontend build compiles into the JavaScript a browser downloads.
 *
 * Each framework marks them with its own prefix, and the build only sees them
 * if they are there while it runs. Both facts matter: they have to reach the
 * build (a Next.js app deployed without `NEXT_PUBLIC_API_URL` at build time
 * ships `undefined` to every browser), and anything under one of these names
 * is readable by anyone who opens the app, so a secret there is published.
 */
const PUBLIC_PREFIXES = [
  "NEXT_PUBLIC_",
  "VITE_",
  "REACT_APP_",
  "PUBLIC_",
  "EXPO_PUBLIC_",
  "NUXT_PUBLIC_",
  "GATSBY_",
] as const;

export function isPublicEnvName(name: string): boolean {
  return PUBLIC_PREFIXES.some(
    (prefix) => name.startsWith(prefix) && name.length > prefix.length,
  );
}
