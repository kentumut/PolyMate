# PolyMate OpenClaw plugin

This plugin binds tool execution to OpenClaw's trusted session context and signs callbacks to the PolyMate backend. Model arguments cannot choose a student or connection. Install with OpenClaw 2026.9.9 and set `POLYMATE_AGENT_TOOL_URL` and `OPENCLAW_AGENT_BRIDGE_SECRET` in the Gateway environment.

The read-only VVZ tools use the community-maintained [VVZ API](https://vvzapi.ch/) to search ETH course units, retrieve detailed catalogue/lecturer/schedule data, and run an unofficial MSc Computer Science 2020 graduation-planning check. The graduation tool separates passed credits from in-progress/planned projections, validates major/minor combinations, and reports category and Master's-thesis admission deficits. It returns official ETH VVZ links for verification because the upstream service is unofficial and may be stale or incomplete. No API key is required.

See [the agent handoff](../../docs/AI_AGENT_HANDOFF.md) for installation, private networking, agent/tool policy, and verification limits. Run `pnpm agent:sync-openclaw-tools` at the repository root after changing canonical tool schemas; it updates both the schemas and manifest tool inventory.
