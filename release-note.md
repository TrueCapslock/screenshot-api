## v1.0.13 (2026-05-15)

- Menu: `_commit_from_release_note` now renames `## Unreleased` to versioned header before extracting, making commit menu (option 5) self-contained
- Menu: fix awk commit message extraction — match specific version header instead of first `## v`, prevent old version content leaking into commit message
- Menu: robust awk pattern for duplicate version headers (use `!flag &&` guard so duplicate headers trigger the stop rule instead of being consumed by `next`)
- Menu: strip old versioned sections from release-note.md after creating new `## Unreleased` on commit
