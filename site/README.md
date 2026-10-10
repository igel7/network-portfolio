# site/

Static site shell for Who Falls Next. Vite + plain TypeScript, no framework. Fixed dark theme.

## Pages
- `index.html` landing
- `demo.html` demo shell. The core module mounts into `<div id="network-demo-root">`. Until it renders something there, a placeholder says the demo is in development.
- `about.html` author and attribution

## Ownership
- Shell (this directory except `src/demo/`): site task.
- `src/demo/`: core task. Not created here. To integrate, add `<script type="module" src="./src/demo/main.ts">` to `demo.html` where the comment marks it.

## Build
Normal: `npm install` then `npm run build` or `npm run dev` inside `site/`. Output is `site/dist/`.

The repository is now at `C:\network-portfolio`. Use the normal commands above inside `site/`. The optional `build-local.ps1` helper remains available for a mirrored build: from the repository root, run `pwsh -File site/build-local.ps1` (add `-Dev` for the dev server). It mirrors `site/` to `%LOCALAPPDATA%\network-portfolio-site-build`, builds there, and copies `dist/` back.

Base path is `/network-portfolio/` (GitHub Pages project site). Page links are relative, so they also work at any other base. Set `VITE_BASE=/` to preview at the root.
