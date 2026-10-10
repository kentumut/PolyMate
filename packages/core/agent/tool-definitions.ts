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
    description: 'Retrieve this student’s PolyMate and optional Google calendar events for explicit dates (at most 42 days). Personal Google events are read-only. Read the current editable PolyMate event before editing it.',
    parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'], additionalProperties: false },
  },
  {
    name: 'polymate_create_study_block',
    description: 'Create one PolyMate study block only when the student explicitly asks to add it. Supply a clear title and exact start/end instants. The application supplies the owner and a stable retry operation ID.',
    parameters: {
      type: 'object', properties: { title: { type: 'string' }, startAt: { type: 'string' }, endAt: { type: 'string' } },
      required: ['title', 'startAt', 'endAt'], additionalProperties: false,
    },
  },
  {
    name: 'polymate_edit_study_block',
    description: 'Edit the title and/or exact times of an existing PolyMate study block only when the student explicitly requests it. First retrieve the eventId using polymate_get_calendar. The application supplies the owner, current etag, and stable retry operation ID.',
    parameters: {
      type: 'object', properties: { eventId: { type: 'string' }, title: { type: 'string' }, startAt: { type: 'string' }, endAt: { type: 'string' } },
      required: ['eventId'], anyOf: [{ required: ['title'] }, { required: ['startAt', 'endAt'] }], additionalProperties: false,
    },
  },
  {
    name: 'polymate_move_study_block',
    description: 'Move an existing PolyMate study block only when the student explicitly requests it. First retrieve its eventId using polymate_get_calendar. The application supplies the owner, current etag, and stable retry operation ID. Never create a replacement event.',
    parameters: { type: 'object', properties: { eventId: { type: 'string' }, startAt: { type: 'string' }, endAt: { type: 'string' } }, required: ['eventId', 'startAt', 'endAt'], additionalProperties: false },
  },
] as const;
