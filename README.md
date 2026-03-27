# XussBrowser

XussBrowser is a desktop browser workspace manager built with Electron, Vue 3, Prisma, and SQLite.

It focuses on three core jobs:

1. Creating isolated local Chromium profile directories.
2. Persisting per-profile fingerprint configurations.
3. Injecting the saved fingerprint into browser pages through the Chromium DevTools Protocol at launch time.

## Highlights

- Electron main / preload / renderer architecture with typed IPC boundaries
- Prisma + SQLite local persistence
- Profile CRUD with per-profile storage directories
- Persisted fingerprint settings:
  - enable or disable fingerprinting per profile
  - choose a preferred OS template or leave it random
  - persist the generated fingerprint config in the profile record and `fingerprint.json`
- Runtime injection flow:
  - launch Chromium with a remote debugging port
  - attach to the browser over CDP
  - register the fingerprint script for every new page
  - expose `window.__xussFingerprint.verify()` for in-page validation
- Built-in verification action that opens a dedicated verification page in the running browser
- Persisted browser executable path in app settings, with environment variable override support

## Tech Stack

- Electron
- Vue 3
- Pinia
- Element Plus
- Prisma
- SQLite
- TypeScript

## Requirements

- Node.js `18.18+` or `20+`
- npm
- A Chromium-compatible executable available locally

Notes:

- The current development machine in this workspace reports Node `18.17.1`. Build and typecheck work, but the ESLint toolchain now expects `18.18+`.
- On Windows, you can either save the browser path from the Settings page or set `XUSS_BROWSER_EXECUTABLE`.

## Install

```bash
npm install
npm run db:generate
```

## Development

```bash
npm run dev
```

## Build

```bash
npm run build
```

To build a Windows package:

```bash
npm run build:win
```

## Project Structure

```text
src/
  main/        Electron main process and runtime services
  preload/     Typed IPC bridge exposed to the renderer
  renderer/    Vue UI
  shared/      Shared types, schemas, and constants

prisma/
  schema.prisma
  bootstrap.sql
```

## Fingerprint Flow

1. Create or edit a profile in the dashboard.
2. In the Fingerprint step:
   - choose whether fingerprinting is enabled
   - optionally pick a preferred OS template
   - preview the generated fingerprint
3. Save the profile.
4. Start the profile.
5. Click `Verify` on a running profile card.
6. XussBrowser opens a browser page that reads `window.__xussFingerprint.verify()` from the page context and prints the observed values.

## Browser Executable Resolution

At runtime, XussBrowser resolves the Chromium executable in this order:

1. `XUSS_BROWSER_EXECUTABLE`
2. Saved application setting from the Settings page
3. `DEFAULT_BROWSER_PATH` in `src/shared/constants.ts`

## Commands

```bash
npm run dev
npm run typecheck
npm run lint
npm run build
npm run build:win
npm run db:generate
```

## Validation Checklist

- `npm run typecheck`
- `npm run build`
- Start a profile and use `Verify` to confirm the injected fingerprint is visible in page context

## Known Notes

- `npm run lint` depends on a Node version that satisfies the current ESLint ecosystem requirement (`18.18+` recommended).
- The runtime browser must support Chromium remote debugging endpoints.
