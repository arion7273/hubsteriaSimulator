# Hubsteria Simulator — demo facility pilot

Independent browser simulator for https://hubsteriacare.com/app. Authorized scope: **HubsteriaCare demo facility** only. No automatic GitHub Actions are installed.

## Run locally

Use Node.js 20 or newer.

```bash
npm install
npx playwright install chromium
cp config.example.json config.local.json
```

Edit `config.local.json` with the demo organization and facility UUIDs. After signing in and selecting the demo facility, use browser DevTools → Application → Local Storage:

- `hc.currentOrgId` — organization UUID  
- `hc.activeFacility:<organization UUID>` — facility UUID  

Use **two distinct staff accounts** for the demo facility. Save each session in a visible browser (MFA supported; no bypass):

```bash
npm run login -- caregiver-1
npm run login -- caregiver-2
npm test
npm run plan
npm run simulate
```

Optional stop during a run: `touch .simulator-stop` or Ctrl+C.

Reports are written under `reports/` as HTML + JSON. Failure screenshots are captured only after demo scope is confirmed.

## What the pilot does

- Two concurrent Playwright sessions (separate storage state per alias).
- Scope guard on local storage **and** `/rest/v1/facilities` before charting actions.
- Charting Sheet medication flow: resident → pending scheduled dose → **GIVE** (`data-testid="charting-sheet-med-give-<occurrenceKey>"`), with server-side verification of `medication_administrations` after refresh (not toast-only).
- Distinct dose assignments per caregiver; separate **collision** scenario on one shared occurrence.
- Concurrent ADL, vitals, and quick-note flows using fictional demo text only.
- Bounded rounds, pauses, and `maxActionMs`; no automatic retry of uncertain medication writes.
- Timing hints to separate host load from slow network responses.

## Multi-facility later

Configuration is single-facility today (`facilityId` / `organizationId`). Scenario code is structured so additional authorized facilities can be added behind an allowlist without changing the guard primitives.

## Never commit

`.auth/`, `config.local.json`, `reports/`, `.simulator-stop`, credentials, or resident exports.
