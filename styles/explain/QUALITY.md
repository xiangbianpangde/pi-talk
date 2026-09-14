# Explain Design System — Quality Gates

1. **Zero details rule**: Explain pages must never render `<details>` accordion toggles. Content must be 100% directly visible.
2. **Audit gate**: Fragments must pass `auditExplainContent` with 0 errors and 0 warnings.
3. **Contrast**: All text and badge tokens must maintain >= 4.5:1 contrast on `--bg` and white.
4. **Deterministic build**: `node build.mjs --check` passes cleanly.
5. **No active content**: No scripts, styles, iframes, or unsafe URL schemes (`javascript:`, `file:`).
