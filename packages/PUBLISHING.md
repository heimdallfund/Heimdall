# Publishing the Heimdall packages

Four public npm packages. The main repo stays private: npm and the registries only need the packages themselves, plus one small public repo for the ElizaOS plugin.

| Package | What it is |
| --- | --- |
| `@heimdall/sdk` | TypeScript SDK: Shield, vaults, Pay, Auto-Invest, Signals |
| `@heimdall/agent-kit` | Tools for the Vercel AI SDK, LangChain and ElizaOS |
| `@heimdall/mcp` | MCP server (`npx @heimdall/mcp`) with 14 tools |
| `@heimdall/plugin-heimdall` | ElizaOS plugin (thin wrapper over `agent-kit/eliza`) |

## 1. npm

1. Create an npm account and an organization named `heimdall`. If that name is taken, use another (for example `heimdallfund`) and pass it to the release script with `--scope @heimdallfund`. The script renames the packages and their imports in the tarballs; then update the install lines in `apps/web/src/lib/frameworks.ts`, `apps/web/src/lib/mcpClients.ts` and the docs.
2. `npm login`, with two-factor authentication on.
3. Dry run, which builds, tests, packs and smoke-tests everything in an empty project (imports every entry point, then lists the MCP tools over stdio):
   ```bash
   node packages/release.mjs
   ```
4. Publish, in dependency order:
   ```bash
   node packages/release.mjs --publish --otp <code>
   ```

## 2. Official MCP Registry

`@heimdall/mcp` carries `"mcpName": "fund.heimdall/mcp"`, a name proven by DNS on heimdall.fund, so no public GitHub repo is needed.

```bash
# once: a key pair, and its public half as a DNS TXT record on heimdall.fund
openssl genpkey -algorithm Ed25519 -out mcp-registry-key.pem          # keep this file out of the repo
echo "heimdall.fund. IN TXT \"v=MCPv1; k=ed25519; p=$(openssl pkey -in mcp-registry-key.pem -pubout -outform DER | tail -c 32 | base64)\""
# add that TXT record at the DNS provider, wait for it to propagate, then:
mcp-publisher login dns --domain heimdall.fund --private-key "$(openssl pkey -in mcp-registry-key.pem -noout -text | grep -A3 'priv:' | tail -n +2 | tr -d ' :\n')"
mcp-publisher publish /tmp/heimdall-release/server.json
```

`mcp-publisher` comes from the releases page of github.com/modelcontextprotocol/registry. Instead of DNS, the same public key can be served at `https://heimdall.fund/.well-known/mcp-registry-auth` (`mcp-publisher login http`).

The release script writes `server.json` with the published version. Publish to npm first: the registry checks that the npm package exists and carries the same `mcpName`.

## 3. ElizaOS plugin registry

The registry needs a public GitHub repo for the plugin.

1. Create a public repo `plugin-heimdall` and push only `packages/plugin-heimdall/` to it (it holds no secrets and no Heimdall internals: it imports the published `@heimdall/agent-kit`).
2. Replace `<GITHUB_ORG>` in its `package.json` and in `registry-entry.json`.
3. Add the topic `elizaos-plugins` to the repo.
4. From the plugin folder: `elizaos plugins submit .` (it opens the registry pull request with `registry-entry.json`'s content).

## 4. Other directories (optional, after npm)

Smithery, Glama and mcp.so list MCP servers from npm or a submission form. Use this text:

> **Heimdall Shield** — a firewall for AI agents on Robinhood Chain. Before your agent signs, Shield simulates the transaction or signature and answers ALLOW, WARN or DENY, with the reasons and every token that would move. 14 tools: transaction and signature checks, address vetting, Wallet Check (risky approvals), the Threat Board, Heimdall Pay escrow, the Agent Arena and vault limits. Free tier: 1,000 checks a day per wallet.
>
> `npx -y @heimdall/mcp`
