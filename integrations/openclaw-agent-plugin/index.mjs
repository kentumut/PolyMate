import { readFileSync } from 'node:fs';
import { Type } from 'typebox';
import { defineToolPlugin } from 'openclaw/plugin-sdk/tool-plugin';
import { invokePolyMateTool } from './bridge.mjs';

const definitions = JSON.parse(readFileSync(new URL('./moodle-tool-definitions.json', import.meta.url), 'utf8'));
export default defineToolPlugin({
  id: 'polymate-agent',
  name: 'PolyMate Study Tools',
  description: 'Owner-scoped study planning, calendar, progress, ETH VVZ course discovery, and graduation-planning tools for PolyMate.',
  tools: tool => definitions.map(definition => {
    const parameters = Type.Unsafe(definition.parameters);
    return tool({
      name: definition.name,
      label: definition.name,
      description: definition.description,
      parameters,
      factory({ toolContext }) {
        const sessionKey = toolContext.sessionKey;
        if (typeof sessionKey !== 'string' || !sessionKey) return null;
        return {
          name: definition.name,
          label: definition.name,
          description: definition.description,
          parameters,
          async execute(_toolCallId, args, signal) {
            signal?.throwIfAborted();
            const result = await invokePolyMateTool({
              toolUrl: process.env.POLYMATE_AGENT_TOOL_URL,
              bridgeSecret: process.env.OPENCLAW_AGENT_BRIDGE_SECRET,
              sessionKey,
              name: definition.name,
              args,
              signal,
            });
            return {
              content: [{ type: 'text', text: JSON.stringify(result) }],
              details: result,
            };
          },
        };
      },
    });
  }),
});
