-- #1272: the built-in type 'retro' became 'presentation_demo'. History notes each moved call.
INSERT INTO changes (id, ts, actor, entity_type, entity_id, field, before, after, summary, reason, status, undoable)
SELECT 'chg_m14_' || id, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER), 'job:job_call_type',
       'call', id, 'call_type', 'retro', 'presentation_demo',
       'Retro is now Presentation/Demo', 'call_type_renamed', 'applied', 0
FROM calls WHERE call_type = 'retro';
UPDATE calls SET call_type = 'presentation_demo', rev = rev + 1 WHERE call_type = 'retro';

