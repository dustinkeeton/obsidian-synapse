# synapse-mcp

An MCP server that lets an agent drive the Synapse Obsidian plugin through its public API. An MCP client such as Claude Code or Claude Desktop starts it over stdio. Each tool call becomes one fixed call to `app.plugins.plugins.synapse.api` through the Obsidian CLI's `eval` command. The agent supplies only arguments, which travel as JSON data and never as code. Arguments over 8 KB, such as a long reply sent to `jobs_commit`, go through a file in the OS temp folder (or `SYNAPSE_MCP_TEMP_DIR`) that only your user can read, and the file is deleted after the call. The plugin opens no port.

The API is unstable until epic #629 ships, and so is this server.

## Requirements

- Obsidian 1.12 or later on desktop, with its command line interface turned on, running with the vault open.
- A Synapse build that has the public API (`app.plugins.plugins.synapse.api`), enabled in that vault.
- Node.js 20 or later.

## Setup

Build it from this repository:

```sh
cd mcp
npm ci
npm run build
```

Add it to Claude Code:

```sh
claude mcp add synapse -e SYNAPSE_VAULT="My Vault" -- node /path/to/obsidian-synapse/mcp/dist/index.js
```

Or add it to Claude Desktop's `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "synapse": {
      "command": "node",
      "args": ["/path/to/obsidian-synapse/mcp/dist/index.js"],
      "env": { "SYNAPSE_VAULT": "My Vault" }
    }
  }
}
```

Settings, all optional, go in the environment:

| Variable | Default | Meaning |
|----------|---------|---------|
| `SYNAPSE_VAULT` | the CLI's own choice | The vault name passed to the CLI as `vault=` |
| `OBSIDIAN_CLI` | `obsidian` | Path to the Obsidian CLI. Set it when the client's `PATH` does not include it, as with some desktop apps |
| `SYNAPSE_MCP_MAX_WAIT_MS` | `600000` (10 minutes) | How long a long tool follows its job before returning it still running |
| `SYNAPSE_MCP_SAMPLING` | on | `off` stops the server from asking the client's model for text |
| `SYNAPSE_MCP_SAMPLING_TIMEOUT_MS` | `1500000` (25 minutes) | How long one sampling request may take, including the user's approval. Synapse fails an unanswered request after 30 minutes |
| `SYNAPSE_MCP_TEMP_DIR` | the OS temp folder | Where arguments over 8 KB are staged for Obsidian to read. Set it to an absolute path Obsidian can reach when it runs sandboxed (Flatpak, Snap), for example `/home/me/My Vault/.synapse` |

## Tools

The server builds its tools from `capabilities()` whenever the client lists them, so the tools always match the plugin version in the vault. Each verb becomes a tool named with `_` for `.`, for example `deepDive.run` becomes `deepDive_run`. Its arguments are the verb's parameters by name, and its output schema is the verb's `result` schema. Verbs whose feature is turned off are left out. When a call finds that the set of available verbs has changed, the server tells the client to list its tools again. The plugin checks every argument against the verb's schema, and an unknown argument name is refused before the call.

A verb's result comes back as structured content. A result with `ok: false` is reported as a tool error, with the result still attached.

Tools that can rewrite or move existing notes, or reject proposals (a deep-dive reject also rejects its children and rewrites the run's navigation blocks), are marked destructive: `proposals_accept`, `proposals_reject`, `deepDive_regenerate`, and `elaborate`, `scanFolder`, `deepDive_run`, `deepDive_continue` and `jobs_commit`, which write directly when auto-accept is on. An accepted deep-dive note also rewrites the navigation blocks of the run's earlier notes, and can be organized into another folder.

Tools that can send note text to an AI provider or the web are marked open-world: the long verbs, `proposals_accept` (an accept can run enrichment, title, REM, illustrate or organize afterwards) and `jobs_commit`.

Long verbs (`elaborate`, `scanFolder` and the `deepDive_*` tools) start a job, and the tool follows it:

- When the client asks for progress, it sends a notification each time the job's status line changes, and repeats the last line every 5 seconds, so a client that resets its own timeout on progress keeps waiting.
- Cancelling the tool call cancels the job, the same as pressing Cancel on its toast. That includes a client giving up on its own timeout, so on a client that does not reset its timeout on progress, set `SYNAPSE_MCP_MAX_WAIT_MS` below that timeout. The tool then returns the job still running, and `jobs_wait` follows it without cancelling it. That limit is checked between polls, so it doesn't cut short a sampling request that is still out. On such a client, also set `SYNAPSE_MCP_SAMPLING=off`, or a `SYNAPSE_MCP_SAMPLING_TIMEOUT_MS` below its timeout, and answer `job.requests` with `jobs_commit`.
- If a call into Obsidian fails while the tool follows the job, the tool returns an error with the job's `jobId`. The job may still be running. Follow it with `jobs_wait`, or stop it with `jobs_cancel`.
- It returns what `jobs_wait` returns, `{ ok, timedOut, job }`, with the verb's result on `job.result`. A job still running after `SYNAPSE_MCP_MAX_WAIT_MS` comes back with `timedOut: true`. Follow it with `jobs_wait`.

## Letting the client's model write the text

With `billing: "external"` in a generating tool's `options`, or with **Agents generate the text** turned on in the feature's settings, the job pauses at each model call with status `awaiting-output`. Its `requests` hold the exact messages Synapse would send.

- When the client supports MCP sampling, the server sends each request to the client's model and commits the replies, and the job goes on. System messages become the sampling system prompt. A reply that stopped at `maxTokens` is committed as truncated, so Synapse discards it as it would a cut-off reply from its own key.
- Without sampling, or if sampling fails, the tool returns the paused job. The agent answers `job.requests` itself with `jobs_commit`. When sampling failed, the result's `samplingError` says why.

## Resources

| URI | Content |
|-----|---------|
| `synapse://status` | `status()`: versions, features, per-feature model and billing, running work, interrupted operations |
| `synapse://proposals` | `proposals.list()`: every pending proposal |
| `synapse://jobs` | `jobs.list()` as `{ jobs }` |
| `synapse://deep-dives/continuable` | Deep dives stopped at their note cap with topics left, as `{ runs }` |

## Development

```sh
npm run typecheck
npm test     # also loads the plugin's real verb definitions from ../src, so run `npm ci` at the repository root first
npm run build
```
