# Testing the OpenAI / OpenClaw workflow

Use Node 24 (`nvm use`) in the iteration worktree. The web app owns Google/Moodle connections, calendar write consent, and identity. OpenClaw runs the model and calls signed backend tools. An OpenAI key belongs to the gateway, never browser code.

## Local setup

With PostgreSQL and `apps/web/.env.local` already configured:

```bash
pnpm install --frozen-lockfile
pnpm agent:setup
# Edit .local/openclaw/provider.env privately: OPENAI_API_KEY=<your key>
pnpm agent:validate
pnpm agent:start
```

In a second terminal in the same worktree:

```bash
pnpm dev
```

The setup installs pinned OpenClaw 2026.9.9 under the ignored `.local/` directory, builds and validates the plugin, generates stable server secrets if absent, and configures a loopback gateway on port 18789. It preserves database, Google, and existing signing configuration. Restart `pnpm dev` after changing its environment. To change the model, edit `POLYMATE_LLM_MODEL` in the private provider file, rerun `pnpm agent:setup`, and restart the gateway. The default is `openai/gpt-5.6-terra`; account model availability is checked separately from billing/quota.

Open <http://127.0.0.1:3000/calendar?view=chat> and ask “Check my connected services.” Or run `pnpm agent:smoke`: this requires both a real model reply and a signed, read-only connection-status tool card. It does not add calendar events.

Google still requires an OAuth application, even though each student authorizes inside PolyMate. Reuse the existing OAuth client credentials privately, retain local encryption keys, and register `http://127.0.0.1:3000/api/integrations/google/callback` as an authorized redirect URI on that Google Cloud OAuth client. The current deployed client rejects this local URI (`redirect_uri_mismatch`). Once registered, use Settings → Connect Google Calendar and finish Google's consent screen yourself. Moodle is connected with the student's private calendar subscription URL in Settings.

Try this journey after connecting:

1. Ask the agent to show upcoming Moodle calendar entries.
2. Select an entry, supply your own effort estimate and available hours, and ask for a draft timeline.
3. Inspect the draft; check that no calendar events were added yet.
4. Explicitly approve adding the proposed blocks, then reload Google Calendar and PolyMate.
5. Ask to move one block, inspect it, and confirm. Report study progress and confirm the progress card.

The separate Assignments panel tests iteration 2's manual-assignment planner: add a future assignment with effort, generate a draft using your availability, inspect it, and apply it. The agent's Moodle timeline tools and the manual planner are separate paths at this stage.

## Production

The existing production gateway is manually provisioned. It has working OpenAI credentials, but the currently deployed web release sends an unscoped session key and fails against the two-agent roster. This branch sends `agent:<agent-id>:<signed-turn>` and an explicit agent header. Gateway tool policy must also include the three newly merged study-progress tools.

After the normal peer review and green CI, use the managed gateway defined in `compose.openclaw.yaml`:

1. Preserve the current gateway state and back up the private VM `.env`. Remove the old manually managed gateway only during the reviewed cutover, after recording its container configuration for recovery; do not run two gateways with the same network alias.
2. In the private VM `.env`, set `OPENCLAW_ENABLED=true`, `OPENAI_API_KEY`, `POLYMATE_LLM_MODEL=openai/gpt-5.6-terra`, and the existing `OPENCLAW_GATEWAY_TOKEN`, `AGENT_CONTEXT_SECRET`, and `OPENCLAW_AGENT_BRIDGE_SECRET`. Preserve all Google/encryption/database settings. The gateway uses a new named state volume; reconcile any registered cron jobs with the database before enabling background jobs. Do not discard the old state directory.
3. Run the repository's reviewed `scripts/deploy.sh <commit>`. It builds the pinned gateway with the canonical plugin tool list and starts it on the private Compose network, without publishing a gateway port. Only the gateway receives `OPENAI_API_KEY`. The normal web deployment still works with `OPENCLAW_ENABLED=false` for an externally managed gateway.
4. At the managed website, ask “Check my connected services.” Repeat the real Google journey with a test event. Container readiness alone is not a model/tool acceptance check.

For a trusted-network smoke test, execute `scripts/agent-smoke.mjs` inside the web network with `AGENT_SMOKE_BASE=http://web:3000`, `AGENT_SMOKE_ORIGIN` set to the managed HTTPS origin, and an isolated `AGENT_SMOKE_USER`. Never send trusted identity headers to bypass public authentication.

If the first gateway-enabled release fails, deployment restores the prior web image independently when no prior gateway image exists. Inspect and recover the manually managed gateway from the saved configuration if needed. Subsequent managed releases can restore the prior gateway image; persistent gateway state and PostgreSQL are retained.

References: [OpenAI API quickstart](https://developers.openai.com/api/docs/quickstart), [OpenClaw OpenAI setup](https://docs.openclaw.ai/providers/openai/setup), [OpenClaw HTTP API](https://docs.openclaw.ai/gateway/openai-http-api).
