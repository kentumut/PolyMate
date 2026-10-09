# PolyMate

PolyMate is a proactive AI study companion for ETH CS bachelor's and master's students. It connects academic deadlines, study planning, Telegram check-ins, exercise tutoring, and relevant academic opportunities.

## Project documents

- **Start here:** [Five-person delivery schedule](TEAM_SCHEDULE.md): named roles, parallel tasks per iteration, branch/file ownership, and release gates.
- [Product specification](POLYMATE_SPEC.md): agreed student experience, hackathon scope, and success criteria.
- [Implementation plan](IMPLEMENTATION_PLAN.md): staged VM architecture, service contracts, testing, and deployment/recovery runbook.
- [Earlier campus companion concept](SPEC.md): background reference for broader discovery features.

**First release:** a working interactive calendar with live Google Calendar integration. Automatic backend planning follows in iteration 2; imports/adaptation, Telegram/AI, and learning/discovery come afterward.

The five positions are Yildirim (calendar interface), Dogancem (scheduling/calendar service), Kent (integration/release), Bartek (data/connections), and Catalin (student workflow/quality).

The implementation plan targets the VIScon team 07 VM and adapts the hosting choices to its managed proxy, authentication, and API credits. Application implementation has not started in this repository.
