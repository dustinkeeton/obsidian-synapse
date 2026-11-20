# 002: MCP server package over the Obsidian CLI

**Date**: 2026-11-19
**Status**: Accepted
**Gates**: #628 (MCP stdio shim), epic #629

## Context

Agents reach Synapse's public API (`app.plugins.plugins.synapse.api`, #623) only through `obsidian eval`. That runs any code the agent writes inside Obsidian, with full vault and Node access. MCP clients expect tools with typed arguments, progress, cancellation and sampling instead. Two locked constraints apply: the plugin ships no runtime npm dependencies, and it opens no network listener (an in-plugin HTTP server is out of scope in #629).

## Decision

Add `synapse-mcp`, a separate Node package in `mcp/` with its own `package.json` and lock file. Its only runtime dependency is `@modelcontextprotocol/sdk`, pinned exactly. An MCP client launches it over stdio. Each tool call becomes one fixed `obsidian eval` expression. The verb must be a plain own member of the API object, and the arguments are embedded as a JSON string literal, so nothing the agent sends becomes code. Tools are generated from `capabilities()` on every list, with output schemas taken from each verb's new `result` schema. Long verbs follow their job with progress notifications, cancel it when the call is cancelled, and answer external-billing requests through MCP sampling when the client offers it. The plugin bundle does not include the package. It runs only on desktop, where the Obsidian 1.12+ CLI exists.

## Consequence

The plugin keeps zero runtime dependencies and gains no port. The SDK's supply chain sits in a package the user installs separately and only when they want MCP. Every verb now carries a `result` JSON Schema. MCP clients enforce it as an output schema, so a plugin test checks real results against it, and the shim's tests run a real SDK client against the plugin's real verb definitions. The shim and the API are versioned together in one repository while the API is unstable. `mcp/` has its own CI job. Mobile vaults cannot be reached this way. Each call starts a CLI process, which costs some latency per call. That is acceptable for agent use, and the reason long verbs poll in 5-second slices rather than continuously.
