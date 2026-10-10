import { readFile, writeFile } from 'node:fs/promises';
import { AGENT_TOOL_DEFINITIONS } from '../packages/core/agent/tool-definitions.ts';

const output = new URL('../integrations/openclaw-agent-plugin/moodle-tool-definitions.json', import.meta.url);
await writeFile(output, `${JSON.stringify(AGENT_TOOL_DEFINITIONS, null, 2)}\n`, 'utf8');
const manifestUrl = new URL('../integrations/openclaw-agent-plugin/openclaw.plugin.json', import.meta.url);
const manifest = JSON.parse(await readFile(manifestUrl, 'utf8')) as { contracts: { tools: string[] } };
manifest.contracts.tools = AGENT_TOOL_DEFINITIONS.map(tool => tool.name);
await writeFile(manifestUrl, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
