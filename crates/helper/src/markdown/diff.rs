// Ported from Comet (github.com/zeronsh/comet), MIT License, Copyright 2026
// Wing — with adaptations for solid-gpui (Apache-2.0; see
// THIRD_PARTY_NOTICES.md).
//
// Adaptation delta vs upstream (crates/ui/src/changes.rs @ 0.2.28): upstream
// is a full "Changes" pane (watch streams, branch scopes, comment cards,
// fold tweens, split layout) deeply coupled to Comet's app state. Only the
// separable core is ported here: the per-line classification of a unified
// diff (LineKind Add/Del/Context/Meta plus hunk headers) so ```diff fences
// in markdown render with conventional add/del coloring. No patch parser
// object model, virtualization, or comments.

//! Per-line classification of unified-diff text for ```diff code fences.
//!
//! A fence line maps to exactly one kind by its prefix; painting derives
//! from the kind alone (text tone + row wash), keeping highlight pure paint.

/// One diff line's role, derived from its prefix (upstream LineKind, minus
/// the parser's object model: we classify raw fence lines in place).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiffLineKind {
    /// `+` added line.
    Add,
    /// `-` deleted line.
    Del,
    /// `@@ -a,b +c,d @@` hunk header.
    Hunk,
    /// File/hunk plumbing: `diff --git`, `index`, `+++`/`---` headers,
    /// `\ No newline at end of file`.
    Meta,
    /// Anything else (unchanged context lines, blank lines).
    Context,
}

/// Classify one fence line by prefix. Order matters: `@@` is always a Hunk;
/// `+++ `/`--- ` (git headers always carry the trailing space before the
/// path) are Meta even though they start with `+`/`-` — without the space
/// gate, ADDED CONTENT beginning with `++` (e.g. `+++i;`) would
/// misclassify as Meta.
pub fn classify(line: &str) -> DiffLineKind {
    if line.starts_with("@@") {
        return DiffLineKind::Hunk;
    }
    if line.starts_with("+++ ") || line.starts_with("--- ") {
        return DiffLineKind::Meta;
    }
    const META_PREFIXES: [&str; 11] = [
        "diff ",
        "index ",
        "old mode ",
        "new mode ",
        "new file mode ",
        "deleted file mode ",
        "rename from ",
        "rename to ",
        "copy from ",
        "copy to ",
        "similarity index ",
    ];
    if META_PREFIXES.iter().any(|p| line.starts_with(p))
        || line.starts_with("Binary files ")
        || line.starts_with('\\')
    {
        return DiffLineKind::Meta;
    }
    if line.starts_with('+') {
        return DiffLineKind::Add;
    }
    if line.starts_with('-') {
        return DiffLineKind::Del;
    }
    DiffLineKind::Context
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefixes_map_to_the_five_kinds() {
        let cases = [
            ("+added line", DiffLineKind::Add),
            ("-removed line", DiffLineKind::Del),
            ("@@ -12,7 +12,8 @@", DiffLineKind::Hunk),
            ("diff --git a/x b/x", DiffLineKind::Meta),
            ("index abc..def 100644", DiffLineKind::Meta),
            ("+++ b/added.txt", DiffLineKind::Meta),
            ("--- a/old.txt", DiffLineKind::Meta),
            ("\\ No newline at end of file", DiffLineKind::Meta),
            ("new file mode 100644", DiffLineKind::Meta),
            ("deleted file mode 100644", DiffLineKind::Meta),
            ("rename from a/x", DiffLineKind::Meta),
            ("Binary files /a/x and /b/x differ", DiffLineKind::Meta),
            ("similarity index 92%", DiffLineKind::Meta),
            (" unchanged context", DiffLineKind::Context),
            ("", DiffLineKind::Context),
            ("plain text that is not a marker", DiffLineKind::Context),
        ];
        for (line, expected) in cases {
            assert_eq!(classify(line), expected, "{line:?}");
        }
    }

    /// Regression (S13f r1 minor): ADDED content beginning with `++` is an
    /// Add line, not a +++ header — the space gate keeps `+++i;` classified
    /// by its real marker. Known stateless limit: content shaped EXACTLY
    /// like a header (`+++ path`) classifies Meta — git always writes
    /// headers that way, so the header reading wins.
    #[test]
    fn content_starting_with_marker_runs_stays_add_or_del() {
        assert_eq!(classify("+++i;"), DiffLineKind::Add);
        assert_eq!(classify("---option"), DiffLineKind::Del);
        // A bare ---/+++ with nothing after it: git never emits these as
        // headers, so they are content.
        assert_eq!(classify("---"), DiffLineKind::Del);
        assert_eq!(classify("+++"), DiffLineKind::Add);
        // Header-shaped content is indistinguishable from a real header
        // without hunk-state tracking — documented Meta outcome.
        assert_eq!(classify("+++ b/f.txt"), DiffLineKind::Meta);
    }

    /// A `+`/`-` INSIDE hunk content after the marker stays Add/Del (the
    /// whole line keeps its kind — no mid-line rescanning).
    #[test]
    fn markers_are_prefix_only() {
        assert_eq!(classify("+-not-a-deletion"), DiffLineKind::Add);
        assert_eq!(classify("-+not-an-addition"), DiffLineKind::Del);
        assert_eq!(classify(" @@ not a hunk"), DiffLineKind::Context);
    }
}
