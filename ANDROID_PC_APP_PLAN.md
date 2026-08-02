# Turning the Calculator into an Android + PC App

Approach: **Option A** — Progressive Web App (PWA), with Android packaged via Trusted Web
Activity (TWA/Bubblewrap). One codebase, free, updates instantly for everyone without
app-store review. iOS/Mac out of scope (not paying Apple's fees right now).

Play Store listing is a separate, later decision — everything below works and is fully
testable without it or its $25 fee.

## Phase 1 — GitHub setup
1. Create a free GitHub account, verify email.
2. Enable Two-Factor Authentication (Settings → Password and authentication).
3. Install the GitHub CLI (`gh`) so Claude can push code on your behalf.
4. Run `gh auth login` once (must be done by you, interactive).
5. Create a new **public** repo, e.g. `magic-survival-calculator`.

## Phase 2 — Claude builds the PWA layer
6. Add `manifest.json` (name, icons, colors, installable config) + a service worker
   (offline caching) to the calculator.
7. Generate app icons in the sizes Android/Chrome expect.
8. Push everything to the new GitHub repo.
9. Enable GitHub Pages for the repo (one checkbox in repo Settings → Pages).

## Phase 3 — Test the easy wins
10. Visit the live URL on PC in Chrome/Edge → click "Install." That's the PC app, done.
11. Visit the same URL on Android in Chrome → "Add to Home Screen." Already gives a real
    installable, offline-capable Android icon, before touching Bubblewrap.

## Phase 4 — Wrap as a real Android APK (TWA)
12. Install a Java JDK (needed for Android signing/build tools).
13. Claude runs Bubblewrap to generate a signed `.apk`, pointed at the live GitHub Pages URL.
14. **Important**: Bubblewrap creates a signing keystore (`.jks`) file — back this up. Losing
    it means losing the ability to update this exact app identity later (matters if/when
    this goes to Play Store).
15. Add a small `assetlinks.json` file to the repo (generated from the signing key) so the
    app feels fully native — no browser address bar.
16. Sideload the `.apk` onto an Android phone (enable "install unknown apps," transfer the
    file, tap install) and test for real.

## After this point
Any calculator fix/feature just gets pushed to GitHub — live instantly for the PC install
and the "Add to Home Screen" Android version. The APK itself only needs rebuilding if the
app's name/icon/identity changes, not for normal bug fixes.

## Local tooling status (checked 2026-08-01)
- Git: installed (2.53.0)
- Node.js: installed (v24.14.0)
- GitHub CLI (`gh`): **not installed** — needed for Phase 1
- Java: **not installed** — needed for Phase 4 (Bubblewrap)
