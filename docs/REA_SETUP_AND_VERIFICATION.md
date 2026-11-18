# REA setup and verification

Verified 2026-11-18. Phase 1 complete for browser observation.

- Existing project folder: `/Users/gokulr/Developer/GitHub/Followers_Only` (empty at inspection). Reused this folder instead of creating a duplicate `FollowersOnly`.
- Workspace parent is not a Git repository. Unrelated Remote AI Platform and REA checkouts were preserved.
- Installed REA: 6.8.0, `/Users/gokulr/.local/share/rea-tool/node_modules/rea-agents`, skill version 49.
- Actual MCP `binary_session` call succeeded and confirmed the running package identity and 229-tool catalog.
- Default Node 26.5.0 fails REA's runtime doctor. Existing isolated `/Users/gokulr/.local/share/rea-runtime/node_modules/node/bin/node` is 22.23.4. Running the installed REA doctor with it returns `healthy: true` for the selected Codex scope and aligned registration.
- Chrome 157.0.8103.39 exposes port 9222. HTTP `/json/version` and `/json/list` return 404. The existing Chrome `DevToolsActivePort` provides a browser WebSocket endpoint. REA discovery and passive inspection both succeed through that endpoint. No browser profile, cookies, passwords, or tokens were copied.
- Harmless test: origin-filtered `list_browser_targets`, then `inspect_web_page` with script sources, storage keys and console text disabled. Discovery evidence: `ev_d537223034364ae8504a9f9e715f18127b2040188d0bbea8c301df1f27069057`; home observation: `ev_a871331c1f218505e3c3e8f49defd203eed510a56d049abdefb734611a13c069`.
- One initially discovered home tab disappeared; refreshed discovery and selected the remaining tab successfully.
- Limitation: REA controlled browser scenarios currently reject WebSocket endpoints and require HTTP discovery, unlike passive inspection. Chrome DevTools connector was used for navigation; all reference findings below came from actual REA passive inspections. No real transactions or account edits were performed.
- Native decompilers are unconfigured and unnecessary for this authorized visible-interface research.
- Local development PostgreSQL 18 initialized inside ignored `.local/postgres`, loopback-only on 55439. Docker daemon was unavailable; no unrelated services were changed.

Reverify browser endpoint each session: Chrome can replace it. Do not persist live browser attachment identifiers or session secrets in source control.
