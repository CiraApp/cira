# Cira

Deploy internal software to your company, and let the people there use it.

```sh
npm install -g @cira-app/cli
cira login
cira deploy
```

That is the whole workflow. Build a normal Next.js app; Cira packages it, hosts
it, and puts it on the shelf your colleagues already open. Nobody configures
cloud infrastructure, and nobody outside your company can reach it.

## Commands

|                      |                                                                     |
| -------------------- | ------------------------------------------------------------------- |
| `cira login`         | Connect this machine. Approve it in a browser; works over SSH.      |
| `cira deploy`        | Deploy this folder. `--space <slug>` when you are in more than one. |
| `cira status`        | What this folder is linked to.                                      |
| `cira whoami`        | Who you are signed in as, and your spaces.                          |
| `cira skill install` | Add the Cira Skill to your coding agents.                           |
| `cira update`        | Update Cira, and the Skill copies you approved.                     |
| `cira logout`        | Forget the stored credential.                                       |

## Capabilities

Deploying also publishes what your app can _do_. Cira reads the code, works out
which routes are business operations worth exposing, and registers them - no
manifest, no MCP server, nothing Cira-specific in your repository.

A confident read-only capability turns itself on. Anything that writes is
registered and left off until someone reviews it. Anything destructive stays
off. Authorised colleagues can then reach those operations from their own AI
assistants, through Cira's permission checks.

## The Cira Skill

`cira login` offers to install a short skill file into the coding agents it
finds - Claude Code, Codex, Pi, Gemini CLI and Cursor - so they know how to
build for Cira and how to deploy it. It asks once and defaults to yes;
declining writes nothing.

## Environment

|                |                                                        |
| -------------- | ------------------------------------------------------ |
| `CIRA_API_URL` | Point at a different Cira.                             |
| `CIRA_HOME`    | Where the credential is stored. Defaults to `~/.cira`. |

## Licence

Apache 2.0. The CLI is a thin client; Cira itself is a hosted service.
