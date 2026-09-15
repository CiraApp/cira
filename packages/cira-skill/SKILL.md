---
name: cira
description: Build and deploy internal company software to Cira. Use when a project is being deployed to Cira or the user asks to work with Cira.
---

# Cira

Cira is where companies deploy and use internal software.

## Core rule

Build normal software using the project's existing framework and conventions. Do not redesign an app around Cira.

Cira automatically analyzes deployed code for reusable business capabilities.

## While building

Make the app easy for Cira to understand without adding Cira-specific architecture:

- Keep meaningful server-side business operations explicit.
- Use descriptive names for business functions and routes.
- Prefer typed inputs and outputs.
- Keep business logic separate from purely presentational UI when practical.
- Keep sensitive or destructive operations clearly separated.
- Preserve the existing architecture unless a real problem requires a change.

Do not create an MCP server for the app.
Do not create manual capability manifests unless Cira explicitly asks for an override.
Do not weaken security or restructure working code only to influence capability detection.

## Cira CLI

Check the current project:

    cira status

Authenticate if needed:

    cira login

Deploy:

    cira deploy

If the user belongs to multiple Spaces and the target Space is known:

    cira deploy --space <slug>

Use only CLI commands and flags that actually exist.

## After deployment

Read Cira's deployment output.

Cira may automatically:

- deploy and link the app
- analyze the codebase
- discover business capabilities
- classify capability risk
- enable safe capabilities

If deployment succeeds, stop unless the user asked for more work.

If Cira reports a capability problem, make the smallest sensible code change that improves clarity or reachability, then redeploy. Never disguise destructive behavior as a safe capability.

## Safety

Never bypass Cira access controls or risk classifications.
Never expose secrets, raw database access, privileged infrastructure operations, or destructive admin functions as ordinary capabilities.

## Goal

The ideal workflow is:

    build normal software
        -> cira deploy
        -> done
