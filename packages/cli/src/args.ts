/**
 * The flags each command that changes something understands. Anything else
 * stops it: `cira deploy --help` used to deploy, and so would a typo in
 * `--space`, into whichever space came first.
 */
const FLAGS: Record<string, { values: readonly string[]; switches: readonly string[] }> =
  {
    deploy: {
      values: ["--space", "--env-file", "--env", "--unset", "--dockerfile"],
      switches: ["--no-env", "--yes", "-y", "--database", "--cache"],
    },
    remove: { values: ["--space", "--app", "--confirm"], switches: ["--yes", "-y"] },
  };

/** The first argument a command does not understand, or null. */
export function unknownArgument(command: string, argv: readonly string[]): string | null {
  const known = FLAGS[command];
  if (known === undefined) return null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const [name] = arg.split("=", 1) as [string];
    if (known.values.includes(name)) {
      if (!arg.includes("=")) i += 1;
      continue;
    }
    if (known.switches.includes(arg)) continue;
    return arg;
  }
  return null;
}
