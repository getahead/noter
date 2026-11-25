-- An invitation is evidence about this call only. The private address is used
-- for identity matching; only display_name crosses the call read boundary.
CREATE TABLE call_guests (
    id TEXT PRIMARY KEY,
    call_id TEXT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    email TEXT COLLATE NOCASE
);
CREATE INDEX call_guests_call ON call_guests(call_id, display_name COLLATE NOCASE);
CREATE UNIQUE INDEX call_guests_email ON call_guests(call_id, email) WHERE email IS NOT NULL;

-- Speaker naming, Undo and voice matching all update speakers. Derive the
-- visible guests from that source so reversing a naming restores the invitation.
CREATE VIEW unconfirmed_guests AS
SELECT g.id, g.call_id, g.display_name FROM call_guests g
WHERE NOT EXISTS (
    SELECT 1 FROM speakers s JOIN people p ON p.id = s.person_id
    WHERE s.call_id = g.call_id AND s.named_by IN ('you', 'voice_profile')
      AND (p.email = g.email COLLATE NOCASE OR (
        (g.email IS NULL OR p.email IS NULL)
        AND g.display_name <> 'Guest' AND (p.display_name = g.display_name COLLATE NOCASE
            OR s.name = g.display_name COLLATE NOCASE
            OR EXISTS (SELECT 1 FROM person_aliases a WHERE a.person_id = p.id
                AND a.alias = g.display_name COLLATE NOCASE))
        AND NOT EXISTS (SELECT 1 FROM call_guests other WHERE other.call_id = g.call_id
            AND other.display_name = g.display_name COLLATE NOCASE AND other.id <> g.id)
      ))
);

-- Repair address-as-name records created by the previous calendar importer.
-- Preserve their ids and any People links and edits.
UPDATE people SET display_name = 'Guest', short_name = CASE WHEN instr(short_name, '@') > 0 THEN 'Guest' ELSE short_name END, rev = rev + 1
WHERE instr(display_name, '@') > 0 AND EXISTS (
    SELECT 1 FROM changes h WHERE h.entity_type = 'person' AND h.entity_id = people.id
        AND h.reason = 'calendar_attendees'
        AND json_extract(CAST(h.delta AS TEXT), '$.display_name[1]') = people.display_name
);

-- Read labels shared by the Calls list, call details, and Markdown exports.
CREATE VIEW call_people_labels AS
SELECT cp.call_id, p.id, p.is_you, cp.invited_only,
    CASE WHEN cp.invited_only AND instr(p.display_name, '@') > 0 THEN 'Guest' ELSE p.display_name END AS display_name,
    CASE WHEN cp.invited_only AND instr(p.short_name, '@') > 0 THEN 'Guest' ELSE p.short_name END AS short_name
FROM call_attendance cp JOIN people p ON p.id = cp.person_id;
