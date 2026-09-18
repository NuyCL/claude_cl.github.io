# claude_repo

A static `index.html` landing page, deployed to GitHub Pages via GitHub Actions.

## Deploy

1. In the repo, go to **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Push to `main` (or run the `Deploy static site to GitHub Pages` workflow manually) — the site publishes automatically via `.github/workflows/deploy-pages.yml`.

Once enabled, the page is served at `https://<owner>.github.io/<repo>/`.
