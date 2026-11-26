-- #1272: saved Ask scopes filter by type ids; the built-in 'retro' became 'presentation_demo'.
UPDATE ask_threads SET scope = json_set(scope, '$.call_types', json((
  SELECT json_group_array(CASE value WHEN 'retro' THEN 'presentation_demo' ELSE value END)
  FROM json_each(ask_threads.scope, '$.call_types'))))
WHERE json_valid(scope)
  AND EXISTS (SELECT 1 FROM json_each(ask_threads.scope, '$.call_types') WHERE value = 'retro');
UPDATE ask_turns SET scope = json_set(scope, '$.call_types', json((
  SELECT json_group_array(CASE value WHEN 'retro' THEN 'presentation_demo' ELSE value END)
  FROM json_each(ask_turns.scope, '$.call_types'))))
WHERE scope IS NOT NULL AND json_valid(scope)
  AND EXISTS (SELECT 1 FROM json_each(ask_turns.scope, '$.call_types') WHERE value = 'retro');
