import { cloudRunConfig, googleTokens } from "./cloudrun/config.js";
import { CloudRunProvider } from "./cloudrun/provider.js";
import { SourceStore } from "./cloudrun/source.js";

/**
 * Which provider Cira is using.
 *
 * One place to change, and it fails loudly when unconfigured rather than
 * pretending to deploy and leaving an app stuck saying "deploying" forever.
 */
export function deploymentProvider(): CloudRunProvider {
  const config = cloudRunConfig();
  return new CloudRunProvider(config, googleTokens(config));
}

/**
 * Where uploaded source lands.
 *
 * Separate from the provider because it is used before there is anything to
 * deploy: the CLI uploads, and only then says which space the result belongs
 * in. Same configuration, different moment.
 */
export function sourceStore(): SourceStore {
  const config = cloudRunConfig();
  return new SourceStore(config, googleTokens(config));
}
