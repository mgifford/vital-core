---
description: Use when setting up vetted token-saving tools, language servers, Claude Code plugins, or MCP integrations.
---

# Tooling Setup

Install only with explicit user approval.

Machine-readable install metadata lives in TOOL-CATALOG.json. Use it as the source of truth for CLI-safe commands, binary checks, platform-specific installs, idempotency, and post-install verification.

- ccusage (metrics_telemetry): Optional independent token, cost, and burn-rate accounting. This is measurement, not a direct token reducer.
  Failure modes: `cross_cutting_telemetry`
  Risk/surface: install=`low`, data=`low`, surface=`local_cli_or_local_config`
  Install phases: `waiver`, `detect_platform`, `verify_existing`, `install`, `verify`
  Install reference: `npx ccusage@latest`
  Post-install: restart=`false`, reload=``, verify_cli=`npx ccusage@latest --help`, verify_interactive=``
  Idempotent: `true`
  Source: https://github.com/ryoppippi/ccusage
  Vetting notes: Independent accounting layer; telemetry only, not a direct reducer.
- context-mode (context_defense): Route large tool outputs through sandboxed processing and summaries instead of flooding Claude's live context.
  Failure modes: `tool_output_flooding`
  Risk/surface: install=`low`, data=`low`, surface=`claude_plugin_plus_mcp`
  Conflicts/overlap: `token_optimizer_mcp`, `headroom`; choose one tool for this failure mode unless the user explicitly approves both.
  Install phases: `waiver`, `detect_platform`, `marketplaces`, `plugins`, `reload_or_restart`, `verify`
  Install reference: `/plugin marketplace add mksglu/context-mode
/plugin install context-mode@context-mode
/reload-plugins
/context-mode:ctx-doctor`
  Install interactive: `/plugin marketplace add mksglu/context-mode
/plugin install context-mode@context-mode`
  Marketplace CLI: `claude plugin marketplace add mksglu/context-mode`
  Install CLI: `claude plugin install context-mode@context-mode`
  Post-install: restart=`true`, reload=`/reload-plugins`, verify_cli=`claude plugin list --json`, verify_interactive=`/context-mode:ctx-doctor`
  Idempotent: `false`
  Source: https://github.com/mksglu/context-mode
  Vetting notes: MCP-side context reducer; primary candidate for mcp_tool_output_bloat.
- github (mcp_integration): Fetch structured issue and PR context without pasting browser output or long terminal dumps into Claude.
  Failure modes: `tool_output_flooding`
  Risk/surface: install=`medium`, data=`medium`, surface=`reviewed_third_party_or_official_plugin`
  Install phases: `waiver`, `detect_platform`, `binaries`, `plugins`, `reload_or_restart`, `verify`
  Install reference: `/plugin install github@claude-plugins-official`
  Install interactive: `/plugin install github@claude-plugins-official`
  Install CLI: `claude plugin install github@claude-plugins-official`
  Post-install: restart=`true`, reload=`/reload-plugins`, verify_cli=`claude plugin list --json`, verify_interactive=``
  Idempotent: `false`
  Source: https://claude.com/plugins/github
  Vetting notes: Exact source URL is included; confirm current install instructions before running commands.
- grepai (local_semantic_retrieval): Use local semantic code search and call graphs to reduce repeated grep/read loops without sending code to a hosted retrieval service.
  Failure modes: `repeated_codebase_navigation`
  Risk/surface: install=`medium`, data=`medium`, surface=`local_binary_plus_optional_embedding_provider`
  Conflicts/overlap: `claude_context`, `serena`, `codegraph`, `semble`; choose one tool for this failure mode unless the user explicitly approves both.
  Install phases: `waiver`, `detect_platform`, `binaries`, `verify`
  Install reference: `brew install yoanbernabeu/tap/grepai
grepai init
grepai watch`
  Binary check: name=`grepai`, check=`grepai --version`, expect=`grepai\s+v?\d+|\d+\.\d+`, verify_after=`which grepai`
  Binary install hint: `Requires an embedding provider such as Ollama; install with curl script only after reviewing the GitHub source.`
  Platform installs: darwin=`brew install yoanbernabeu/tap/grepai` linux=`Review https://github.com/yoanbernabeu/grepai for current Linux install instructions before installing.`
  Post-install: restart=`false`, reload=``, verify_cli=`grepai --help`, verify_interactive=``
  Idempotent: `false`
  Source: https://github.com/yoanbernabeu/grepai
  Vetting notes: Local-first; requires embedding provider setup.
- rtk (advanced_shell_compression): RTK (Rust Token Killer, rtk-ai/rtk) compresses common shell command output before it reaches Claude; useful when terminal output is a dominant waste source.
  Failure modes: `noisy_terminal_logs`
  Risk/surface: install=`high`, data=`high`, surface=`local_binary_plus_claude_hook`
  Conflicts/overlap: `leanctx`, `headroom`; choose one tool for this failure mode unless the user explicitly approves both.
  Ambiguity warning: RTK means github.com/rtk-ai/rtk. Never install the unrelated npm package named rtk.
  Install phases: `waiver`, `detect_platform`, `binaries`, `verify`
  Install reference: `Review https://github.com/rtk-ai/rtk first. If approved on macOS: brew install rtk
rtk init -g`
  Binary check: name=`rtk`, check=`rtk --version`, expect=`rtk\s+v?\d+|\d+\.\d+`, verify_after=`which rtk`
  Binary install hint: `This is github.com/rtk-ai/rtk. Do not install the unrelated npm package named rtk.`
  Platform installs: darwin=`brew install rtk` linux=`Review https://github.com/rtk-ai/rtk for current Linux install instructions before installing.`
  Post-install: restart=`false`, reload=``, verify_cli=`rtk --help`, verify_interactive=``
  Idempotent: `false`
  Source: https://github.com/rtk-ai/rtk
  Vetting notes: Rewrites shell command execution. This is github.com/rtk-ai/rtk, not the unrelated npm package named rtk.
- rust-analyzer-lsp (code_intelligence): Use Rust symbol navigation and diagnostics to avoid context-heavy compile/search loops.
  Failure modes: `repeated_codebase_navigation`
  Risk/surface: install=`medium`, data=`medium`, surface=`reviewed_third_party_or_official_plugin`
  Install phases: `waiver`, `detect_platform`, `binaries`, `plugins`, `reload_or_restart`, `verify`
  Install reference: `/plugin install rust-analyzer-lsp@claude-plugins-official`
  Install interactive: `/plugin install rust-analyzer-lsp@claude-plugins-official`
  Install CLI: `claude plugin install rust-analyzer-lsp@claude-plugins-official`
  Binary check: name=`rust-analyzer`, check=`rust-analyzer --version`, expect=`rust-analyzer`, verify_after=`which rust-analyzer`
  Binary install hint: `rustup component add rust-analyzer`
  Post-install: restart=`true`, reload=`/reload-plugins`, verify_cli=`claude plugin list --json`, verify_interactive=``
  Idempotent: `false`
  Source: https://claude.com/plugins/rust-analyzer-lsp
  Vetting notes: Exact source URL is included; confirm current install instructions before running commands.
- semble (path_limited_semantic_retrieval): Use path-limited semantic retrieval to replace broad repeated reads when the target area is known.
  Failure modes: `repeated_codebase_navigation`
  Risk/surface: install=`medium`, data=`medium`, surface=`local_binary_plus_optional_embedding_provider`
  Conflicts/overlap: `claude_context`, `grepai`, `serena`, `codegraph`; choose one tool for this failure mode unless the user explicitly approves both.
  Install phases: `waiver`, `detect_platform`, `verify_existing`, `install`, `verify`
  Install reference: `Review https://github.com/MinishLab/semble and configure it with path limits before use.`
  Binary check: name=`semble`, check=`semble --version`, expect=`semble\s+v?\d+|\d+\.\d+`, verify_after=`which semble`
  Binary install hint: `Keep searches path-constrained; broad retrieval can add more context than it saves.`
  Idempotent: `false`
  Source: https://github.com/MinishLab/semble
  Vetting notes: Best repeated retrieval result on the noisy fixture when used with path limits.
- typescript-lsp (code_intelligence): Use symbol navigation and diagnostics instead of repeated grep/read loops in JavaScript and TypeScript projects.
  Failure modes: `repeated_codebase_navigation`
  Risk/surface: install=`medium`, data=`medium`, surface=`reviewed_third_party_or_official_plugin`
  Install phases: `waiver`, `detect_platform`, `binaries`, `plugins`, `reload_or_restart`, `verify`
  Install reference: `/plugin install typescript-lsp@claude-plugins-official`
  Install interactive: `/plugin install typescript-lsp@claude-plugins-official`
  Install CLI: `claude plugin install typescript-lsp@claude-plugins-official`
  Binary check: name=`typescript-language-server`, check=`typescript-language-server --version`, expect=`\d+\.\d+`, verify_after=`which typescript-language-server`
  Binary install hint: `npm install -g typescript typescript-language-server`
  Post-install: restart=`true`, reload=`/reload-plugins`, verify_cli=`claude plugin list --json`, verify_interactive=``
  Idempotent: `false`
  Source: https://claude.com/plugins/typescript-lsp
  Vetting notes: Exact source URL is included; confirm current install instructions before running commands.


Installation order:

1. waiver: read WAIVER.md to the user in summary form and get explicit acceptance.
2. detect_platform: verify OS, package manager, Claude Code version, and existing binaries/plugins.
3. binaries: install required binaries first, using the binary.check and binary.verify_after fields.
4. marketplaces: add required marketplaces with marketplace_cli.
5. plugins: install plugins with install_cli; install_interactive is for human slash-command use only.
6. reload_or_restart: run /reload-plugins or restart Claude Code when post_install.requires_restart is true.
7. verify: run post_install.verify_cli or post_install.verify_interactive and stop if verification fails.

If a recommended binary is already installed, do not reinstall it. If a repository has custom tooling, prefer its checked-in setup docs over generic install commands.
