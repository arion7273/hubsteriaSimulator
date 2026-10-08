# Hubsteria Simulator — first pilot

Independent browser simulator for https://hubsteriacare.com/app. Authorized scope: **HubsteriaCare demo facility** only. No automatic GitHub Actions are installed.

## Run locally in Cursor

Use Node.js 20 or newer. From this repository's terminal:

```bash
npm install
npx playwright install chromium
cp config.example.json config.local.json
```

Edit config.local.json with the actual demo organization and facility UUIDs. To find these, manually sign in and select the demo facility, then inspect browser Application → Local Storage: `hc.currentOrgId` is the organization UUID and `hc.activeFacility:<organization UUID>` is the selected facility UUID. Do not copy tokens or passwords into GitHub.

Use two distinct staff accounts belonging to the demo facility. Save each session through a visible browser:

```bash
npm run login -- caregiver-1
npm run login -- caregiver-2
npm test
npm run plan
npm run simulate
```

Sign in manually and complete any MFA. The simulator checks stored scope against a fresh facility response from the app's server. If verification cannot complete, it stops. It does not select a different organization/facility automatically. Expired sessions require logging in again.

Reports are local HTML and JSON files in `reports/`. Navigation timings include DOM loading, app shell visibility, and checks; they are not medication save latency or complete page-render metrics. The report fails on slow timings, app errors, unexpected redirects, or scope/auth failures.

## Implemented scope

Two independent staff sessions browse dashboard, residents, and medication task board concurrently, in bounded rounds. This baseline does not click GIVE, chart ADLs, record vitals, write notes, or verify medication persistence. Auth and page loading may still cause normal application side effects.

## Next: medication workflow

The current HC source has `data-testid="charting-sheet-med-give-${item.key}"`. Before implementing writes, inspect the deployed Charting Sheet, verify the demo resident/order/facility relationship server-side, assign distinct pending dose occurrences to actors, and use actual GIVE/attestation UI. Confirm exactly one saved administration with the matching dose occurrence and caregiver after refresh; a toast is insufficient. Do not copy the HC direct-insert load script, use master credentials, or create random administration timestamps.

Keep the facility guard before every action. Add explicit same-dose collision tests separately from ordinary passes. Respect demo reseeding and report interrupted runs rather than silently retrying writes. Only this facility is authorized; multi-facility testing needs additional authorized demo facilities.

## Cursor handoff

Continue from this working baseline. Keep all development in this repository and use a branch/PR. Preserve exact target and facility restrictions. Implement medication writes only after live demo workflow inspection and per-resident/per-order verification. Run local policy tests; report live checks as unverified until actually run with the two local sessions. Never commit `.auth`, config.local.json, reports, credentials, resident data, or environment files.
