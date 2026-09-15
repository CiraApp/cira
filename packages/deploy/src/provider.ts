import { VercelProvider } from "./vercel.js";

/**
 * Which provider Cira is using.
 *
 * One place to change, and it fails loudly when unconfigured rather than
 * pretending to deploy and leaving an app stuck saying "deploying" forever.
 */
export function deploymentProvider(): VercelProvider {
  const token = process.env["VERCEL_API_TOKEN"];
  const teamId = process.env["VERCEL_DEPLOY_TEAM_ID"];

  if (token === undefined || token === "" || teamId === undefined || teamId === "") {
    throw new Error(
      "Deployments are not configured. Set VERCEL_API_TOKEN and VERCEL_DEPLOY_TEAM_ID.",
    );
  }

  return new VercelProvider({ token, teamId });
}
