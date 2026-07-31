# 08 — Contract: delete legacy tokens, add the linter

**What to build:** The "contract" half of the refactor. With every call site migrated, the superseded tokens are deleted — and a linter lands to stop the drift from ever recurring.

The linter is the project's second test seam. It asserts a machine-checkable property of the delivered stylesheet, which is the only automated guarantee the visual redesign can have.

**Blocked by:** 04, 05, 06, 07 — every migration batch must land before the old forms can be removed.

**Status:** ready-for-agent

- [ ] Every superseded token is deleted, with no remaining references
- [ ] The linter fails on: raw colour outside the token file without an exemption comment; off-scale font sizes; off-scale spacing; off-scale radii; shadows on non-overlay surfaces; and uses of the importance override beyond a declared allowlist
- [ ] The linter passes on the current codebase
- [ ] The allowlist starts at the current count of importance overrides and is documented as shrinking to zero
- [ ] Screenshots unchanged
