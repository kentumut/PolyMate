import { describe, expect, it } from 'vitest';
import { chatPreviewText } from '../packages/contracts/src/chats';

describe('chatPreviewText', () => {
  it('shows a Markdown plan reply as plain text', () => {
    const reply = 'Draft ready (estimates: 12 h total).\n\n- **Sun 11 Oct, 13:30–19:00:** Quiz 03, *Moodle* Quiz\n- **Mon 12 Oct:** finish `Blatt 4`\n\n## Next\n1. See [the plan](https://example.com)\n\n---\n> Approve?';
    expect(chatPreviewText(reply)).toBe('Draft ready (estimates: 12 h total). Sun 11 Oct, 13:30–19:00: Quiz 03, Moodle Quiz Mon 12 Oct: finish Blatt 4 Next See the plan Approve?');
  });

  it('keeps ordinary punctuation and identifiers', () => {
    expect(chatPreviewText('Use snake_case_name and 2 * 3 * 4.')).toBe('Use snake_case_name and 2 * 3 * 4.');
  });

  it('truncates long previews with an ellipsis', () => {
    const preview = chatPreviewText('a'.repeat(300));
    expect(preview).toHaveLength(200);
    expect(preview.endsWith('…')).toBe(true);
  });
});
