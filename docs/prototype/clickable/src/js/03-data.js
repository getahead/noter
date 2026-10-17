/* =====================================================================
   Sample data — example records shaped like the core's view models
   (DESIGN 3.1). Everything here is invented example content.
   "Today" in the prototype is Thursday 16 October 2026.
   Screen modules may ADD keys to NP.data; do not rename existing ones.
   ===================================================================== */
(function () {
  const D = NP.data;

  D.today = { label: 'Thursday 16 October', iso: '2026-10-16' };

  D.people = [
    { id: 'p-you', name: 'You', short: 'You', initials: 'You', role: 'Team lead, frontend', you: true },
    { id: 'p-anna', name: 'Anna Kuznetsova', short: 'Anna K.', initials: 'AK', role: 'Frontend developer', org: 'Virtuozzo', email: 'anna.k@example.com', aliases: ['Аня', 'Anna'], voiceProfile: true, lang: 'ru' },
    { id: 'p-pavel', name: 'Pavel Romanov', short: 'Pavel', initials: 'PR', role: 'Product manager', org: 'Virtuozzo', email: 'pavel.r@example.com', aliases: ['Pavel R.', 'Паша'], voiceProfile: false, lang: 'en' },
    { id: 'p-dmitri', name: 'Dmitri Sokolov', short: 'Dmitri S.', initials: 'DS', role: 'Backend lead', org: 'Virtuozzo', email: 'dmitri.s@example.com', aliases: ['Дима', 'Dima'], voiceProfile: true, lang: 'ru' },
    { id: 'p-oleg', name: 'Oleg Morozov', short: 'Oleg M.', initials: 'OM', role: 'QA engineer', org: 'Virtuozzo', email: 'oleg.m@example.com', aliases: ['Олег'], voiceProfile: false, lang: 'ru' },
    { id: 'p-lena', name: 'Lena Krüger', short: 'Lena K.', initials: 'LK', role: 'Designer', org: 'Virtuozzo', email: 'lena.k@example.com', aliases: ['Lena'], voiceProfile: false, lang: 'de' },
    { id: 'p-markus', name: 'Markus Weber', short: 'Markus W.', initials: 'MW', role: 'Vendor account manager', org: 'MonitorCo', email: 'm.weber@example.com', aliases: [], voiceProfile: false, lang: 'de' },
  ];
  D.person = (id) => D.people.find((p) => p.id === id) || { id, name: id, short: id, initials: '?' };

  D.agents = [
    { id: 'ag-architect', name: 'Architect', runtime: 'Claude Code', model: 'Sonnet', effort: 'Medium', enabled: true, callTypes: ['Planning', 'Design review', 'Backend sync'], budget: 25, order: 1, status: 'ok', skill: 'architect.md', cards7d: 41, useful: 38 },
    { id: 'ag-pm', name: 'Product manager', runtime: 'Claude Code', model: 'Sonnet', effort: 'Low', enabled: true, callTypes: ['Planning', '1:1'], budget: 20, order: 2, status: 'ok', skill: 'product-manager.md', cards7d: 33, useful: 31 },
    { id: 'ag-designer', name: 'Designer', runtime: 'Codex', model: 'gpt-5-codex', effort: 'Low', enabled: true, callTypes: ['Planning', 'Design review'], budget: 15, order: 3, status: 'ok', skill: 'designer.md', cards7d: 18, useful: 22 },
    { id: 'ag-qa', name: 'QA lead', runtime: 'Claude Code', model: 'Haiku', effort: 'Low', enabled: true, callTypes: ['Planning', 'QA sync'], budget: 15, order: 4, status: 'ok', skill: 'qa-lead.md', cards7d: 12, useful: 25 },
    { id: 'ag-security', name: 'Security reviewer', runtime: 'Local model', model: 'Qwen3 14B', effort: 'Medium', enabled: true, callTypes: ['Design review', 'Vendor'], budget: 10, order: 5, status: 'ok', skill: 'security-reviewer.md', cards7d: 6, useful: 33 },
    { id: 'ag-scribe', name: 'Scribe', runtime: 'Claude Code', model: 'Haiku', effort: 'Low', enabled: true, callTypes: ['All'], budget: 15, order: 6, status: 'ok', skill: 'scribe.md', cards7d: 64, useful: 41 },
    { id: 'ag-devils', name: "Devil's advocate", runtime: 'Codex', model: 'gpt-5-codex', effort: 'High', enabled: false, callTypes: ['Planning'], budget: 0, order: 7, status: 'unavailable', skill: 'devils-advocate.md', cards7d: 0, useful: 0 },
  ];

  D.topics = [
    { id: 't-drawer', name: 'Drawer redesign', calls: 6, decisions: 3, open: 2, lang: 'en' },
    { id: 't-ws', name: 'Websocket notifications', calls: 4, decisions: 2, open: 1, lang: 'en', mergeWith: 't-notif' },
    { id: 't-notif', name: 'Notification service', calls: 5, decisions: 2, open: 1, lang: 'en' },
    { id: 't-license', name: 'Lizenzprüfung im Installer', calls: 2, decisions: 1, open: 1, lang: 'de' },
    { id: 't-openstack', name: 'OpenStack upgrade', calls: 3, decisions: 2, open: 0, lang: 'en' },
    { id: 't-retention', name: 'Monitoring data retention', calls: 2, decisions: 0, open: 2, lang: 'en' },
  ];

  D.calls = [
    { id: 'c-live', title: 'Planning: VHI 8.0 drawer redesign', type: 'Planning', date: '16 Oct', dateLong: 'Today', time: '10:00', start: '10:00', length: '48 min', minutes: 48, platform: 'Microsoft Teams', people: ['p-anna', 'p-pavel', 'p-dmitri', 'p-you'], unnamed: ['Speaker 3'], languages: ['EN', 'RU', 'DE'], tags: ['release', 'vhi-8.0'], privacy: 'Normal', mode: 'Cloud, redacted', runtime: 'Claude Code', status: 'ready', openItems: 3, suggested: 5, topics: ['t-drawer', 't-ws'] },
    { id: 'c-backend', title: 'Backend sync', type: 'Backend sync', date: '2 Oct', dateLong: 'Thu 2 Oct', time: '16:00', length: '52 min', minutes: 52, platform: 'Zoom', people: ['p-dmitri', 'p-oleg', 'p-you'], unnamed: [], languages: ['RU', 'EN'], tags: ['backend'], privacy: 'Normal', mode: 'Cloud, redacted', runtime: 'Claude Code', status: 'ready', openItems: 2, suggested: 2, topics: ['t-ws', 't-notif'] },
    { id: 'c-1on1-anna-9', title: '1:1 with Anna K.', type: '1:1', date: '9 Oct', dateLong: 'Thu 9 Oct', time: '14:30', length: '31 min', minutes: 31, platform: 'Microsoft Teams', people: ['p-anna', 'p-you'], unnamed: [], languages: ['RU', 'EN'], tags: [], privacy: 'Normal', mode: 'Cloud', runtime: 'Claude Code', status: 'ready', openItems: 1, suggested: 0, topics: ['t-drawer'] },
    { id: 'c-design', title: 'Design review: notifications panel', type: 'Design review', date: '8 Oct', dateLong: 'Wed 8 Oct', time: '11:00', length: '44 min', minutes: 44, platform: 'Google Meet', people: ['p-lena', 'p-anna', 'p-pavel', 'p-you'], unnamed: [], languages: ['DE', 'EN'], tags: ['release'], privacy: 'Normal', mode: 'Cloud, redacted', runtime: 'Claude Code', status: 'ready', openItems: 1, suggested: 0, topics: ['t-notif'] },
    { id: 'c-vendor', title: 'Vendor call: MonitorCo', type: 'Vendor', date: '7 Oct', dateLong: 'Tue 7 Oct', time: '15:00', length: '38 min', minutes: 38, platform: 'Zoom', people: ['p-markus', 'p-you'], unnamed: ['Speaker 2'], languages: ['DE', 'EN'], tags: [], privacy: 'Sensitive', mode: 'Sensitive · local', runtime: 'Local model', status: 'ready', openItems: 2, suggested: 0, topics: ['t-retention'] },
    { id: 'c-qa', title: 'Cross-team QA sync', type: 'QA sync', date: '6 Oct', dateLong: 'Mon 6 Oct', time: '12:00', length: '27 min', minutes: 27, platform: 'Microsoft Teams', people: ['p-oleg', 'p-anna', 'p-you'], unnamed: [], languages: ['RU'], tags: ['release'], privacy: 'Normal', mode: 'Cloud, redacted', runtime: 'Claude Code', status: 'ready', openItems: 1, suggested: 0, topics: ['t-license'] },
    { id: 'c-openstack', title: 'OpenStack upgrade planning', type: 'Planning', date: '1 Oct', dateLong: 'Wed 1 Oct', time: '10:00', length: '61 min', minutes: 61, platform: 'Zoom', people: ['p-dmitri', 'p-pavel', 'p-you'], unnamed: [], languages: ['EN'], tags: ['infra'], privacy: 'Normal', mode: 'Cloud', runtime: 'Codex', status: 'ready', openItems: 0, suggested: 0, topics: ['t-openstack'] },
    { id: 'c-installer', title: 'Installer review', type: 'Design review', date: '29 Sep', dateLong: 'Mon 29 Sep', time: '13:00', length: '35 min', minutes: 35, platform: 'Microsoft Teams', people: ['p-lena', 'p-oleg', 'p-you'], unnamed: [], languages: ['DE'], tags: ['installer'], privacy: 'Normal', mode: 'Local only', runtime: 'Local model', status: 'ready', openItems: 1, suggested: 0, topics: ['t-license'] },
  ];
  D.call = (id) => D.calls.find((c) => c.id === id) || D.calls[0];

  /* Upcoming calendar events (Today) */
  D.events = [
    { id: 'e-1', time: '10:00', title: 'Planning: VHI 8.0 drawer redesign', people: ['p-anna', 'p-pavel', 'p-dmitri'], platform: 'Teams', callId: 'c-live', lastTime: 'estimates parked, empty state has no owner', lastCallId: 'c-backend', items: ['i-spec', 'i-replay', 'i-virt'], questions: ['q-notif'] },
    { id: 'e-2', time: '14:30', title: '1:1 with Anna K.', people: ['p-anna'], platform: 'Teams', items: ['i-spec', 'i-a11y'], questions: [], lastCallId: 'c-1on1-anna-9', lastTime: 'agreed on Friday for the spec' },
    { id: 'e-3', time: '16:00', title: 'Backend sync', people: ['p-dmitri', 'p-oleg'], platform: 'Zoom', items: [], questions: [], lastCallId: 'c-backend', lastTime: 'reconnect owner still open' },
  ];
  D.week = [
    { id: 'w-1', day: 'Tue', title: 'Cross-team QA sync', summary: '2 items owed', items: ['i-checklist', 'i-license'] },
    { id: 'w-2', day: 'Fri', title: 'Vendor call', summary: 'Local only', items: ['i-retention'] },
  ];

  /* Items: decisions, action items, open questions, risks */
  D.items = [
    { id: 'i-spec', kind: 'action', text: 'Drawer redesign spec by Friday', owner: 'p-anna', due: 'Fri 17 Oct', status: 'open', review: 'accepted', callId: 'c-live', span: '00:19:58', lang: 'en', owedToYou: true, from: '1:1 on 9 Oct', topic: 't-drawer' },
    { id: 'i-replay', kind: 'action', text: 'Replay buffer for websocket reconnects', owner: 'p-dmitri', due: 'Wed 22 Oct', status: 'open', review: 'suggested', callId: 'c-live', span: '00:23:40', issue: 'VSTOR-9912', engineering: true, lang: 'en', topic: 't-ws' },
    { id: 'i-virt', kind: 'action', text: 'Virtualise the 10k-row table in the drawer list', owner: 'p-you', due: 'Today', status: 'handed-off', review: 'accepted', callId: 'c-live', span: '00:31:12', issue: 'VSTOR-1234', engineering: true, handoff: { tool: 'Claude Code', repo: '~/projects/vhi-frontend', at: '11:05', state: 'awaiting PR' }, lang: 'en', topic: 't-drawer' },
    { id: 'i-a11y', kind: 'action', text: 'Check drawer focus order with VoiceOver', owner: 'p-anna', due: 'Mon 20 Oct', status: 'open', review: 'suggested', callId: 'c-live', span: '00:35:02', lang: 'en', topic: 't-drawer' },
    { id: 'i-empty', kind: 'action', text: 'Write empty-state copy for the drawer', owner: 'p-lena', due: 'Tue 21 Oct', status: 'open', review: 'suggested', callId: 'c-live', span: '00:19:40', lang: 'en', topic: 't-drawer' },
    { id: 'i-migration', kind: 'action', text: 'Migration plan VSTOR-9841', owner: 'p-pavel', due: 'Thu 16 Oct', status: 'open', review: 'accepted', callId: 'c-openstack', span: '00:44:10', issue: 'VSTOR-9841', lang: 'en', noCall: true },
    { id: 'i-checklist', kind: 'action', text: 'Handover checklist for QA', owner: 'p-oleg', due: 'Tue 21 Oct', status: 'open', review: 'accepted', callId: 'c-qa', span: '00:12:05', lang: 'ru', textOrig: 'Чеклист передачи для QA' },
    { id: 'i-license', kind: 'action', text: 'Lizenzprüfung im Installer testen', owner: 'p-oleg', due: 'Wed 22 Oct', status: 'open', review: 'accepted', callId: 'c-installer', span: '00:08:30', lang: 'de', topic: 't-license' },
    { id: 'i-retention', kind: 'action', text: 'Get written confirmation of the 30-day retention', owner: 'p-you', due: 'Fri 17 Oct', status: 'open', review: 'accepted', callId: 'c-vendor', span: '00:17:20', lang: 'en', topic: 't-retention' },
    { id: 'i-tokens', kind: 'action', text: 'Rotate the staging Jira token', owner: 'p-you', due: 'Wed 15 Oct', status: 'done', review: 'accepted', callId: 'c-backend', span: '00:47:30', lang: 'en', doneToday: true },
    { id: 'i-demo', kind: 'action', text: 'Send demo recording to Pavel', owner: 'p-you', due: 'Thu 16 Oct', status: 'done', review: 'accepted', callId: 'c-design', span: '00:40:01', lang: 'en', doneToday: true },
    { id: 'd-notif', kind: 'decision', text: 'Drawer events go through the notification service.', owner: 'p-dmitri', callId: 'c-live', span: '00:23:40', lang: 'en', reaffirms: 'Backend sync, 2 Oct', topic: 't-notif' },
    { id: 'd-scope', kind: 'decision', text: 'The redesign keeps the current drawer width of 480 pt.', owner: 'p-pavel', callId: 'c-live', span: '00:27:15', lang: 'en', topic: 't-drawer' },
    { id: 'q-notif', kind: 'question', text: 'Which notification service for the drawer?', callId: 'c-backend', span: '00:38:12', lang: 'en', parked: '2 Oct', topic: 't-notif' },
    { id: 'q-reconnect', kind: 'question', text: 'Who owns the acceptance criteria for the reconnect?', callId: 'c-live', span: '00:20:58', lang: 'en', topic: 't-ws' },
    { id: 'r-estimate', kind: 'risk', text: 'Estimates for the drawer depend on the backend replay buffer.', callId: 'c-live', span: '00:29:44', lang: 'en', topic: 't-drawer' },
  ];
  D.item = (id) => D.items.find((i) => i.id === id);

  /* Transcript of the live / most recent call (c-live) */
  D.segments = [
    { t: '00:19:40', speaker: 'p-pavel', text: 'The empty state for the drawer is still open. Nobody owns the copy.', lang: 'EN', conf: 0.97 },
    { t: '00:19:58', speaker: 'p-anna', text: 'Я сделаю drawer redesign до пятницы.', lang: 'RU', conf: 0.94, trans: 'I will do the drawer redesign by Friday.' },
    { t: '00:20:21', speaker: 'p-you', text: 'We parked that two weeks ago.', lang: 'EN', conf: 0.98 },
    { t: '00:20:35', speaker: 'Speaker 3', text: 'Fast, ja. Der Kanal ist da, aber der Reconnect fehlt noch.', lang: 'DE', conf: 0.81, trans: 'Almost, yes. The channel is there, but the reconnect is still missing.' },
    { mark: true, t: '00:21:00', text: 'Marked 00:21:00' },
    { t: '00:21:12', speaker: 'p-dmitri', text: 'Websocket уведомления идут через notification service, как решили второго октября.', lang: 'RU', conf: 0.92, term: { word: 'notification service', orig: 'нотификейшн сервис' } },
    { t: '00:21:40', speaker: 'p-pavel', text: 'Then who writes the acceptance criteria for the reconnect handling?', lang: 'EN', conf: 0.96 },
    { t: '00:22:05', speaker: ['p-anna', 'Speaker 3'], crosstalk: true, text: 'I can— / Ich kann das machen.', lang: 'EN', conf: 0.62 },
    { gap: true, t: '00:22:10', text: 'Paused 00:22:10–00:22:40' },
    { t: '00:22:41', speaker: 'p-dmitri', text: 'I will add a replay buffer on the backend, VSTOR-9912.', lang: 'EN', conf: 0.95 },
    { t: '00:23:02', speaker: 'Guest (your side)', text: 'Sorry, quick one: the 10k-row table needs virtualising first.', lang: 'EN', conf: 0.88 },
    { t: '00:23:20', speaker: 'p-you', text: 'Agreed. I will hand that off today.', lang: 'EN', conf: 0.99 },
    { hypothesis: true, t: '00:23:31', speaker: 'p-pavel', text: 'I think we should ask the backend team whether…', lang: 'EN', conf: 0.7 },
  ];

  /* Copilot cards (live) */
  D.cards = [
    { id: 'k1', num: 1, kind: 'Context', agent: 'Architect', merged: [], age: 'now', text: 'On 2 Oct you and Dmitri S. agreed that drawer events go through the notification service.', prov: { kind: 'past-call', label: 'Backend sync · 2 Oct · 00:41:10', callId: 'c-backend' } },
    { id: 'k2', num: 2, kind: 'Ask', agent: 'Product manager', merged: ['Designer'], age: '45 s', text: 'Who owns the acceptance criteria for the reconnect handling?', prov: { kind: 'this-call', label: 'This call · 00:21:40' } },
    { id: 'k3', num: 3, kind: 'Answer', agent: 'QA lead', merged: [], age: '1 min', text: 'The handover checklist was promised by Oleg M. for Tuesday 21 Oct.', prov: { kind: 'past-call', label: 'Cross-team QA sync · 6 Oct · 00:12:05', callId: 'c-qa' } },
  ];
  D.earlierCards = [
    { id: 'k0a', kind: 'Context', agent: 'Scribe', text: 'Anna K. committed to the drawer spec by Friday on 9 Oct.', prov: { kind: 'past-call', label: '1:1 with Anna K. · 9 Oct · 00:12:30' }, outcome: 'Pinned' },
    { id: 'k0b', kind: 'Answer', agent: 'Architect', text: 'VSTOR-1234 is In Progress, assigned to you.', prov: { kind: 'jira', label: 'Jira · looked up 10:14' }, outcome: 'Dismissed' },
    { id: 'k0c', kind: 'Answer', agent: 'Security reviewer', text: 'Retention of monitoring data is probably 90 days.', prov: { kind: 'guess', label: 'Model guess · unverified' }, outcome: 'Expired' },
  ];
  D.contextChips = [
    { label: 'Planning · 2 Oct', kind: 'call' },
    { label: 'Drawer spec §3', kind: 'doc' },
    { label: 'VSTOR-9912', kind: 'jira' },
  ];

  /* Proposals waiting (self-maintenance) */
  D.proposals = [
    { id: 'pr-1', title: 'Close “Virtualise the 10k-row table…”', reason: 'PR #448 merged with VSTOR-1234 on 16 Oct', kind: 'Close item', target: 'i-virt', confidence: 'High' },
    { id: 'pr-2', title: 'Apply term “ostor” to 14 transcripts', reason: 'You corrected “o-store” to “ostor” 3 times', kind: 'Term', target: 'glossary', confidence: 'High' },
    { id: 'pr-3', title: 'Merge “Websocket notifications” into “Notification service”', reason: 'Same subject in 4 calls', kind: 'Merge topics', target: 't-ws', confidence: 'Medium' },
    { id: 'pr-4', title: 'Name Speaker 2 in “Vendor call: MonitorCo” as Markus W.', reason: 'Voice and calendar match', kind: 'Name speaker', target: 'c-vendor', confidence: 'Medium' },
  ];

  /* Change log (History, Activity) */
  D.changes = [
    { id: 'ch-1', at: '11:42', day: 'Today', actor: 'You', what: 'Accepted 3 action items', target: 'Planning: VHI 8.0 drawer redesign', kind: 'review' },
    { id: 'ch-2', at: '11:05', day: 'Today', actor: 'You', what: 'Handed off “Virtualise the 10k-row table” to Claude Code', target: 'VSTOR-1234', kind: 'handoff' },
    { id: 'ch-3', at: '10:49', day: 'Today', actor: 'Noter', what: 'Wrote summary, 4 action items and 2 decisions', target: 'Planning: VHI 8.0 drawer redesign', kind: 'outputs' },
    { id: 'ch-4', at: '03:12', day: 'Today', actor: 'Reconciliation job', what: 'Applied term “shaman” to 37 segments', target: '9 calls', kind: 'batch', batch: 37 },
    { id: 'ch-5', at: '03:05', day: 'Today', actor: 'Evidence job', what: 'Closed “Rotate the staging Jira token”', target: 'VSTOR-9790 moved to Done', kind: 'evidence' },
    { id: 'ch-6', at: '17:20', day: 'Yesterday', actor: 'You', what: 'Named Speaker 2 as Dmitri S.', target: 'Backend sync', kind: 'naming' },
    { id: 'ch-7', at: '16:02', day: 'Yesterday', actor: 'You', what: 'Merged Anna K. into Anna Kuznetsova', target: 'People', kind: 'merge' },
  ];

  /* Jobs and sources (Activity, Settings) */
  D.jobs = [
    { id: 'j-recon', name: 'Reconciliation', last: 'Today 03:12', status: 'ok', detail: '37 changes in 9 calls' },
    { id: 'j-evidence', name: 'Evidence collection', last: 'Today 03:05', status: 'ok', detail: '1 item closed, 1 proposal' },
    { id: 'j-topics', name: 'Topic threads', last: 'Today 03:20', status: 'ok', detail: '1 merge suggested' },
    { id: 'j-index', name: 'Search index', last: 'Today 03:40', status: 'warning', detail: 'Rebuilding · 64 %' },
    { id: 'j-backup', name: 'Backup', last: 'Yesterday 23:00', status: 'error', detail: 'Backup disk not connected' },
  ];
  D.sources = [
    { id: 's-conf', name: 'Confluence · DEV space', kind: 'Confluence', mode: 'Sync', schedule: 'Every 6 hours', privacy: 'Normal', scope: '412 pages', status: 'ok', last: 'Today 09:00' },
    { id: 's-jira', name: 'Jira · VSTOR', kind: 'Jira', mode: 'Live lookup', schedule: 'On demand', privacy: 'Normal', scope: 'VSTOR project', status: 'ok', last: 'Today 10:14' },
    { id: 's-folder', name: '~/Documents/Specs', kind: 'Folder', mode: 'Watch', schedule: 'On change', privacy: 'Sensitive', scope: '58 files', status: 'ok', last: 'Today 08:41' },
    { id: 's-bb', name: 'Bitbucket · vhi-frontend', kind: 'Bitbucket', mode: 'Evidence', schedule: 'Nightly', privacy: 'Normal', scope: '1 repository', status: 'error', last: 'Yesterday 03:00', error: 'Token rejected (401)' },
  ];

  /* Repositories (handoff) */
  D.repos = [
    { id: 'r-1', jira: 'VSTOR · frontend', path: '~/projects/vhi-frontend', tool: 'Claude Code' },
    { id: 'r-2', jira: 'VSTOR · backend', path: '~/projects/vhi-backend', tool: 'Codex' },
  ];

  /* Performance (targets come from the PRD) */
  D.metrics = [
    { id: 'm-card', label: 'Card latency p50', value: '5.2 s', target: '≤ 6 s', status: 'ok' },
    { id: 'm-card95', label: 'Card latency p95', value: '10.8 s', target: '≤ 10 s', status: 'off' },
    { id: 'm-hyp', label: 'Hypothesis lag', value: '1.4 s', target: '≤ 2 s', status: 'ok' },
    { id: 'm-conf', label: 'Confirmed lag', value: '3.1 s', target: '≤ 4 s', status: 'ok' },
    { id: 'm-post', label: 'Outputs ready, cloud', value: '1 min 40 s', target: '≤ 2 min', status: 'ok' },
    { id: 'm-mem', label: 'Extra memory in call', value: '3.2 GB', target: '≤ 4 GB', status: 'ok' },
  ];
  D.stages = [
    { id: 'st-vad', label: 'Voice activity', budget: 300, actual: 240 },
    { id: 'st-asr', label: 'Transcription', budget: 1500, actual: 1400 },
    { id: 'st-trigger', label: 'Trigger', budget: 500, actual: 380 },
    { id: 'st-retrieve', label: 'Retrieval', budget: 800, actual: 1350 },
    { id: 'st-llm', label: 'Model', budget: 2500, actual: 2900 },
    { id: 'st-render', label: 'Render', budget: 200, actual: 120 },
  ];

  /* Settings panes (DESIGN: 11 panes) */
  D.settingsPanes = [
    { id: 'general', label: 'General', icon: 'gear' },
    { id: 'recording', label: 'Recording', icon: 'mic' },
    { id: 'callscreen', label: 'Call Screen & Menu Bar', icon: 'display' },
    { id: 'models', label: 'Models & Runtimes', icon: 'agent' },
    { id: 'privacy', label: 'Privacy', icon: 'lock' },
    { id: 'repositories', label: 'Repositories', icon: 'branch' },
    { id: 'knowledge', label: 'Knowledge Sources', icon: 'books' },
    { id: 'people', label: 'People & Voices', icon: 'people' },
    { id: 'maintenance', label: 'Maintenance', icon: 'wand' },
    { id: 'hotkeys', label: 'Hotkeys', icon: 'keyboard' },
    { id: 'advanced', label: 'Advanced', icon: 'terminal' },
  ];

  /* Audit (Privacy: what left this Mac) */
  D.audit = [
    { at: '10:49', what: 'Transcript text of “Planning: VHI 8.0 drawer redesign”, names replaced, sent to Claude Code for the summary', bytes: '42 KB' },
    { at: '10:14', what: 'Search for “VSTOR-1234” sent to Jira', bytes: '1 KB' },
    { at: '10:12', what: '9 copilot prompts with redacted transcript excerpts sent to Claude Code', bytes: '18 KB' },
  ];

  /* Helpers */
  D.initials = (name) => {
    const parts = String(name).split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0][0];
    return (parts[0][0] + parts[1][0]).toUpperCase();
  };
})();
