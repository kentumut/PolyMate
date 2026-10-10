# PolyMate OpenClaw plugin

This plugin binds tool execution to OpenClaw's trusted session context and signs callbacks to the PolyMate backend. Model arguments cannot choose a student or connection. Install with OpenClaw 2026.9.9 and set `POLYMATE_AGENT_TOOL_URL` and `OPENCLAW_AGENT_BRIDGE_SECRET` in the Gateway environment.

See [the agent handoff](../../docs/AI_AGENT_HANDOFF.md) for installation, private networking, agent/tool policy, and verification limits. Run `pnpm agent:sync-openclaw-tools` at the repository root after changing canonical tool schemas; it updates both the schemas and manifest tool inventory.
