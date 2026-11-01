//! The three-way merge of a regenerated section with the user's edit
//! (`cpt-noter-algo-core-postcall-merge`): line changes of both sides against the last generated
//! base; the generator's changes apply where the user changed nothing nearby, and the user's text
//! wins wherever both changed the same lines.

/// One change against the base: base lines `start..end` become `lines`.
#[derive(Debug, Clone, PartialEq)]
struct Hunk<'a> {
    start: usize,
    end: usize,
    lines: Vec<&'a str>,
}

/// The merged body; `conflict` when the user's text won over a generator change on the same
/// lines (the candidate stays a version of its own).
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Merged {
    pub body: String,
    pub conflict: bool,
}

/// The changes that turn `base` into `other`, in base order (a longest common subsequence of
/// lines; sections are short).
fn hunks<'a>(base: &[&'a str], other: &[&'a str]) -> Vec<Hunk<'a>> {
    let (n, m) = (base.len(), other.len());
    let mut lcs = vec![vec![0u32; m + 1]; n + 1];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            lcs[i][j] = if base[i] == other[j] {
                lcs[i + 1][j + 1] + 1
            } else {
                lcs[i + 1][j].max(lcs[i][j + 1])
            };
        }
    }
    let (mut i, mut j) = (0, 0);
    let mut out = vec![];
    let mut open: Option<Hunk> = None;
    while i < n || j < m {
        if i < n && j < m && base[i] == other[j] {
            out.extend(open.take());
            i += 1;
            j += 1;
            continue;
        }
        let h = open.get_or_insert(Hunk {
            start: i,
            end: i,
            lines: vec![],
        });
        if j < m && (i == n || lcs[i][j + 1] >= lcs[i + 1][j]) {
            h.lines.push(other[j]);
            j += 1;
        } else {
            i += 1;
            h.end = i;
        }
    }
    out.extend(open);
    out
}

/// Two changes touch: their base ranges overlap or meet (an insertion at the edge of the other
/// change counts, so neither side's text is split).
fn touch(a: &Hunk, b: &Hunk) -> bool {
    a.start <= b.end && b.start <= a.end
}

// @cpt-algo:cpt-noter-algo-core-postcall-merge:p1
pub(crate) fn merge(base: &str, user: &str, generated: &str) -> Merged {
    // @cpt-begin:cpt-noter-algo-core-postcall-merge:p1:inst-merge-base
    if user == base || user == generated {
        return Merged {
            body: generated.to_owned(),
            conflict: false,
        };
    }
    if generated == base {
        return Merged {
            body: user.to_owned(),
            conflict: false,
        };
    }
    let b: Vec<&str> = base.lines().collect();
    let u: Vec<&str> = user.lines().collect();
    let g: Vec<&str> = generated.lines().collect();
    let mut all: Vec<(bool, Hunk)> = hunks(&b, &u)
        .into_iter()
        .map(|h| (true, h))
        .chain(hunks(&b, &g).into_iter().map(|h| (false, h)))
        .collect();
    all.sort_by_key(|(_, h)| (h.start, h.end));
    // @cpt-end:cpt-noter-algo-core-postcall-merge:p1:inst-merge-base
    // @cpt-begin:cpt-noter-algo-core-postcall-merge:p1:inst-merge-text
    // Changes that touch form one group; each group takes one side's changes.
    let mut groups: Vec<Vec<(bool, Hunk)>> = vec![];
    for (by_user, h) in all {
        match groups.last_mut() {
            Some(group) if group.iter().any(|(_, o)| touch(o, &h)) => group.push((by_user, h)),
            _ => groups.push(vec![(by_user, h)]),
        }
    }
    let mut out: Vec<&str> = vec![];
    let mut at = 0;
    let mut conflict = false;
    for group in groups {
        let mine: Vec<&Hunk> = group.iter().filter(|(u, _)| *u).map(|(_, h)| h).collect();
        let theirs: Vec<&Hunk> = group.iter().filter(|(u, _)| !*u).map(|(_, h)| h).collect();
        let chosen = if mine.is_empty() {
            theirs
        } else {
            // The same change on both sides is no conflict; any other overlap keeps the user's.
            conflict |= !theirs.is_empty() && mine != theirs;
            mine
        };
        for h in chosen {
            out.extend(&b[at..h.start]);
            out.extend(&h.lines);
            at = h.end;
        }
    }
    out.extend(&b[at..]);
    // @cpt-end:cpt-noter-algo-core-postcall-merge:p1:inst-merge-text
    Merged {
        body: out.join("\n"),
        conflict,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const BASE: &str = "One.\nTwo.\nThree.\nFour.\nFive.";

    #[test]
    fn an_unedited_section_takes_the_new_text() {
        let m = merge(BASE, BASE, "New one.\nNew two.");
        assert_eq!(m.body, "New one.\nNew two.");
        assert!(!m.conflict);
    }

    #[test]
    fn an_edit_stays_when_the_generator_changed_nothing() {
        let m = merge(BASE, "One!\nTwo.", BASE);
        assert_eq!(m.body, "One!\nTwo.");
        assert!(!m.conflict);
    }

    #[test]
    fn changes_in_different_places_both_land() {
        let user = "One, edited.\nTwo.\nThree.\nFour.\nFive.";
        let generated = "One.\nTwo.\nThree.\nFour.\nFive, regenerated.";
        let m = merge(BASE, user, generated);
        assert_eq!(
            m.body,
            "One, edited.\nTwo.\nThree.\nFour.\nFive, regenerated."
        );
        assert!(!m.conflict);
        // Insertions far apart too.
        let m = merge(
            BASE,
            "Zero.\nOne.\nTwo.\nThree.\nFour.\nFive.",
            "One.\nTwo.\nThree.\nFour.\nFive.\nSix.",
        );
        assert_eq!(m.body, "Zero.\nOne.\nTwo.\nThree.\nFour.\nFive.\nSix.");
    }

    #[test]
    fn on_the_same_lines_the_user_wins_and_it_is_a_conflict() {
        let user = "One.\nTwo, as I said it.\nThree.\nFour.\nFive.";
        let generated = "One.\nTwo, as the model said it.\nThree.\nFour.\nFive, regenerated.";
        let m = merge(BASE, user, generated);
        assert_eq!(
            m.body,
            "One.\nTwo, as I said it.\nThree.\nFour.\nFive, regenerated."
        );
        assert!(m.conflict);
        // The same change on both sides is applied once, without a conflict.
        let both = "One.\nTwo, agreed.\nThree.\nFour.\nFive.";
        let m = merge(BASE, &format!("{both}\nMine."), &format!("Zero.\n{both}"));
        assert_eq!(m.body, format!("Zero.\n{both}\nMine."));
        assert!(!m.conflict);
    }

    #[test]
    fn a_section_the_generator_emptied_keeps_the_users_lines() {
        let m = merge(BASE, &format!("{BASE}\nMy note."), "");
        assert_eq!(m.body, format!("{BASE}\nMy note."));
        assert!(m.conflict);
        // Unedited, it empties.
        assert_eq!(merge(BASE, BASE, "").body, "");
        // A section new to the base takes the user's lines over the generator's.
        let m = merge("", "Mine.", "Generated.");
        assert_eq!(m.body, "Mine.");
        assert!(m.conflict);
    }

    #[test]
    fn hunks_describe_replacements_insertions_and_deletions() {
        let b = ["a", "b", "c"];
        assert_eq!(
            hunks(&b, &["a", "x", "c", "d"]),
            vec![
                Hunk {
                    start: 1,
                    end: 2,
                    lines: vec!["x"]
                },
                Hunk {
                    start: 3,
                    end: 3,
                    lines: vec!["d"]
                },
            ]
        );
        assert_eq!(
            hunks(&b, &["c"]),
            vec![Hunk {
                start: 0,
                end: 2,
                lines: vec![]
            }]
        );
        assert!(hunks(&b, &b).is_empty());
    }
}
