Outputs of the real CLIs on the owner's Mac, 22 Nov 2026 (Claude Code 2.1.325, codex-cli 0.171.0),
with the email, organisation, account ids, paths, OAuth state and one-time code redacted.

- `claude auth status`: JSON on stdout; exit 0 signed in, exit 1 signed out.
- `claude auth login --claudeai`: opens the browser, prints the page as an OSC 8 link.
- `codex login status`: one line on **stderr**; exit 0 signed in, exit 1 signed out.
- `codex login --device-auth`: page and one-time code on stdout, ANSI-coloured.
- `codex app-server`, `account/read` (after `initialize`), one JSON line per reply: the signed-out
  reply is recorded (0.171.0; 0.163.0 answers the same); the signed-in one follows the CLI's own
  `codex app-server generate-json-schema` (`GetAccountResponse`), since the probe never ran against
  the owner's real Codex home.
