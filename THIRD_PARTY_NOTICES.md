# Third-Party Notices

This project uses open-source dependencies managed through `package-lock.json`.

The dependency tree was reviewed from `package-lock.json` for the `0.1.0` preview. It currently contains packages under these license families:

- MIT: 197 packages
- ISC: 10 packages
- BSD-3-Clause: 4 packages
- Apache-2.0: 3 packages
- BSD-2-Clause: 2 packages
- MIT OR CC0-1.0: 1 package
- CC-BY-4.0: 1 package

Notable transitive dependency:

- `caniuse-lite` is licensed under CC-BY-4.0.

Direct runtime/build dependencies include:

- `@vitejs/plugin-react`
- `electron-vite`
- `react`
- `react-dom`
- `electron`
- `typescript`
- `vite`

For release packaging, generate a fresh third-party license report from the exact lockfile used for the release and include it with the release artifact. This file is a repository-level notice and should not be treated as a substitute for reviewing provider, model, or operating-system distribution terms.
