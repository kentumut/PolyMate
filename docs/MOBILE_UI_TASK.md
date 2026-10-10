# Optional task: Mobile-compatible study companion UI

Priority: optional enhancement after the core Moodle → planning → calendar → progress journey works.

Primary branch: `codex/ai-agent`, coordinated with calendar and progress UI contributors. No separate feature branch is required for this task.

Make PolyMate comfortable to use on a phone, including calendar viewing, account connections, chat, assignment cards, timeline previews and progress replies.

## Scope

- Support narrow screens from 320 CSS pixels upward, plus tablet and desktop layouts. Keep page-level content within the viewport; use deliberate internal scrolling for dense calendar content.
- Give the weekly calendar a usable mobile presentation, such as a day view or horizontally scrollable week with clear date navigation. Keep event details and study-block actions accessible without hover.
- Stack connection panels and content appropriately. Token inputs, connection status, errors and buttons must remain readable and usable.
- Make chat work with the mobile keyboard open: keep the composer reachable, allow history to scroll, and avoid covering the latest message or submit button. Account for browser viewport changes and device safe areas.
- Adapt assignment cards and timeline previews without truncating essential deadlines, source links, unscheduled-work warnings or calendar-write outcomes.
- Make progress actions easy to tap. Provide at least 44 × 44 CSS pixel targets for primary controls and adequate separation between destructive and routine actions.
- Ensure dialogs fit small screens, scroll when needed, preserve visible close/submit actions and support keyboard focus and accessible labels.
- Preserve desktop behavior, browser zoom and readable text. Mobile layout must not remove essential actions or change scheduling permissions.

## Acceptance criteria

- Verify the complete journey at 320, 375 and 390 CSS pixel widths, tablet width and desktop width: connect → chat → assignments → timeline preview → calendar → progress reply.
- No accidental page-level horizontal overflow. Intentional calendar scrolling is discoverable and does not make adjacent content overflow.
- Validate portrait and landscape layouts and the chat composer with the software keyboard open on a real phone or mobile browser environment.
- Check touch interactions, long assignment titles, long messages, many timeline blocks, empty results, loading states, errors and dialogs.
- Confirm accessible labels, focus visibility, readable contrast and usability at 200% zoom.
- Record tested devices/viewports and any remaining limitations in the handoff. Run existing typecheck, lint and build checks if code changes; add focused interaction tests only where they verify meaningful behavior.

This task must not delay the core study companion release. It does not include a native app, app-store packaging, offline mode or push-notification infrastructure.
