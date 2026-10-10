import { MOODLE_AGENT_TOOL_DEFINITIONS } from '../integrations/moodle/tools';

export const POLYMATE_CONNECTIONS_TOOL_DEFINITION = {
  name: 'polymate_check_connections',
  description: 'Check whether this student has a Moodle calendar subscription and Google Calendar connection. Moodle calendar subscriptions also work in registered background runs.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
} as const;

/** Canonical allowlisted tool contracts shared with the OpenClaw tool plugin. */
export const AGENT_TOOL_DEFINITIONS = [
  ...MOODLE_AGENT_TOOL_DEFINITIONS,
  POLYMATE_CONNECTIONS_TOOL_DEFINITION,
  {
    name: 'polymate_get_calendar',
    description: 'Retrieve this student’s Google calendar events for explicit dates (at most 42 days). Personal events are read-only. Read the current editable PolyMate event before requesting a move.',
    parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'], additionalProperties: false },
  },
  {
    name: 'polymate_move_study_block',
    description: 'Move an existing PolyMate study block only when the student explicitly requests it. First retrieve its eventId using polymate_get_calendar. The application supplies the owner, current etag, and stable retry operation ID. Never create a replacement event.',
    parameters: { type: 'object', properties: { eventId: { type: 'string' }, startAt: { type: 'string' }, endAt: { type: 'string' } }, required: ['eventId', 'startAt', 'endAt'], additionalProperties: false },
  },
] as const;
