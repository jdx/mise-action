# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a GitHub Action that installs and configures mise, a polyglot runtime manager. The action is written in TypeScript and published to the GitHub Actions marketplace.

## Development Commands

```bash
# Install dependencies
npm install

# Build, format, lint, and package
npm run all

# Individual commands
npm run format:write  # Format code with Prettier
npm run lint         # Run ESLint and format check
npm run package      # Bundle with ncc for distribution

# Testing
npm run all          # Run full build pipeline
./scripts/test.sh    # Integration test script
```

## Architecture

The action follows GitHub's standard TypeScript action structure:

1. **Entry Point**: `src/index.ts` - Main action logic that:
   - Downloads and installs mise binary
   - Manages caching through GitHub Actions cache
   - Configures environment variables (MISE_*, GITHUB_TOKEN)
   - Runs mise commands (install, reshim, etc.)
   - Exports mise environment variables to GITHUB_ENV

2. **Distribution**: `dist/index.js` - Compiled and bundled output (must be committed)

3. **Action Definition**: `action.yml` - Defines inputs, outputs, and metadata

## Key Implementation Details

- **Cache Management**: Uses content-addressable caching based on mise config files (.mise.toml, .tool-versions, etc.)
- **Binary Download**: Supports downloading from GitHub releases or mise.jdx.dev
- **Platform Support**: Handles Linux (glibc/musl), macOS, and Windows
- **Environment Setup**: Automatically adds mise bin and shims directories to PATH
- **GitHub API**: Uses GITHUB_TOKEN to avoid rate limits when installing GitHub-hosted tools

## Important Notes

- Always run `npm run all` before committing to ensure dist/ is updated
- The dist/ folder must be committed as GitHub Actions runs the compiled code
- Test changes using the action itself (uses: ./) in test workflows
