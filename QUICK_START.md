# Quick Start

## 1. Install

```bash
npm install
npm run db:generate
```

## 2. Launch In Development

```bash
npm run dev
```

## 3. Configure Chromium Path

Use one of these options:

- Set `XUSS_BROWSER_EXECUTABLE`
- Open the Settings page in the app and save the browser executable path
- Fall back to the default path in `src/shared/constants.ts`

## 4. Create A Profile

- Open `Dashboard`
- Click `Create Profile`
- Go to the `Fingerprint` step
- Preview a fingerprint and save the profile

## 5. Verify Injection

- Start the profile
- Click `Verify`
- A verification page opens in the running browser and prints the injected fingerprint report

## 6. Useful Commands

```bash
npm run typecheck
npm run lint
npm run build
npm run build:win
```
