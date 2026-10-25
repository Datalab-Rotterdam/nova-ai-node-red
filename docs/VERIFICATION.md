# Verification record

Validated on Windows on 25 October 2026, with Node-RED 4.1.17 and Node.js 26.5.0; the automated suite was also run on Node.js 22 through `npx --yes --package=node@22 node --test`.

- Runtime and integration tests exercise all eleven REST endpoints against a local HTTP gateway: JSON, subtitle text, multipart uploads, binary audio, pagination, routing and input overrides, tool-only chat, non-text Responses, invalid inputs, malformed output, credentials, API failures, timeout, cancellation, and complete message preservation.
- Editor tests check labels, collapsed advanced sections, validation, capability filtering, unclassified models, manual entry, saved-model warnings, loading/empty/failure states, connection saving, progress feedback, and discovery cancellation. Admin-route tests check the registered read permission, no-store responses, missing connections, server-side credentials, and safe error handling.
- Actual Node-RED runtime integration runs both supplied examples' Nova nodes with mocked responses and no Function node.
- Installed the npm tarball into an isolated Node-RED user directory. Confirmed both examples appear in Import → Examples under the scoped package name. Imported the chat example through that menu, configured a dummy key and local mock URL, deployed the saved connection, discovered the Friendly model, tested the connection, selected the model, deployed, and triggered Inject. Debug showed `Hello! Your Nova chat example works.` See [screenshot](chat-walkthrough.png).
- Visually reviewed the native light-theme Chat and Nova connection dialogs, labels, status feedback, advanced disclosures, palette colors/icons, and import flow. The UI uses Node-RED theme styles without fixed foreground/background colors. Automated checks cover every dialog's labeled fields. A separate dark-theme visual check and exhaustive screen-reader testing remain release checks.
- The editor console exposed Node-RED's reserved `n` property; image count now uses `imageCount` in editor configuration, mapped to API `n`. An editor regression test checks reserved properties.
- `npm audit --omit=dev` reports zero production vulnerabilities (the runtime has no npm dependencies). The development tree currently reports 25 findings (4 moderate, 21 high), including bundled npm and Node-RED dependencies. `npm audit fix` cannot resolve these within the selected Node-RED 4 range; no forced downgrade was applied. Review updated development tooling before release.
- `npm pack --dry-run` verifies that development tools, tests, downloaded references, local Node-RED state, and screenshots are excluded from publication.

The automated checks use mock credentials. Responses and diarization schemas need explicit live validation as described in the README. Scope ownership must be confirmed by the release owner. The source repository is https://github.com/Datalab-Rotterdam/nova-ai-node-red.

## Example expansion in 0.1.1

The package now includes twelve importable flows covering all eleven Nova nodes and both Models operations. The expanded suite has 44 passing tests. Each of the twelve full flows was loaded into the Node-RED runtime and triggered through its actual Inject node against a local mock gateway. Upload examples also passed through the real File in node with an audio Buffer fixture. Tests check useful outputs, complete responses, credentials, image count, embeddings input, pagination settings, absence of automatic triggers, and operation coverage. The new example-flow suite also passes on Node.js 22.

Version 0.1.1 was installed into the persistent /data directory of Docker container mynodered for testing. The README includes an example index and container audio-path guidance. Live API compatibility checks remain unchanged.

## Speech validation feedback in 0.1.2

The suite now has 45 passing tests. HTTP 400/422 errors expose selected validation messages with the connection key and Bearer tokens redacted; non-JSON diagnostics and validation input values are excluded. The speech dialog and example explain how to choose a supported voice. Version 0.1.2 was installed into the Docker test instance. The reported Kokoro HTTP 400 has not been confirmed resolved by a successful live synthesis test.
