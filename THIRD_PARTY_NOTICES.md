# Third-party notices — source staging

DramaGo project-authored source is offered under [MIT](LICENSE). That license does not replace third-party licenses or assert exclusive ownership of general programming techniques. No dependency implementation, Electron executable, browser binary, image, font, video, user database or screenshot is vendored in this source snapshot.

| Direct dependency | Locked version | Declared license |
| --- | --- | --- |
| drizzle-orm | 0.45.2 | Apache-2.0 |
| drizzle-kit | 0.31.10 | MIT |
| electron | 44.7.0 | MIT; bundled Chromium/Node/components retain their own terms |
| @electron/fuses | 2.1.3 | MIT |
| @electron/packager | 20.3.0 | BSD-2-Clause |
| playwright-core | 1.64.0 | Apache-2.0, including its NOTICE |

The [installed dependency inventory](docs/DEPENDENCY_LICENSES.json) records 70 installed Windows package/version entries, declared licenses and hashes of included license/notice files when available. Transitive licenses are MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC and BlueOak-1.0.0. Platform-conditional packages not installed on Windows are not presented as tested.

Some published npm packages omit a root license file; their package metadata declaration is recorded rather than inventing evidence. They are referenced through the lockfile, not copied into this Git repository. Before redistributing a binary, preserve all required copyright, license and notice texts, including Electron's Chromium notices, and independently review missing notices and native components. This source review is not a binary redistribution clearance or legal opinion.

The UI uses project HTML/CSS and inline SVG geometry, not downloaded images or fonts. Historical synthetic writing fixtures are project test material; they are not model quality evidence. Mechanism descriptions are abstract project-authored rules, not transcripts or third-party scene scripts. Historical public reports are preserved with their original limitations. No new third-party product source was imported in this rebuild.
