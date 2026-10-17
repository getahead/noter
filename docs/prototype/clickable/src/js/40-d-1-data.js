/* Group D — example data for Library, Ask and People (invented example content). */
(function () {
  const D = NP.data;
  /* The shell creates NP.local(key) as {} before a screen renders, so an init function passed
     to NP.local would never run; dLocal fills missing defaults once. */
  NP.dLocal = (key, initFn) => {
    const o = NP.local(key);
    if (!o.__dInit) { const d = initFn(); Object.keys(d).forEach((k) => { if (!(k in o)) o[k] = d[k]; }); o.__dInit = true; }
    return o;
  };
  const MON = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
  /** sortable number from '16 Oct' + '10:00' */
  D.callSortKey = (c) => {
    const [d, m] = String(c.date).split(' ');
    return (MON[m] || 0) * 1e6 + (+d || 0) * 1e4 + (+String(c.time || '0').replace(':', '') || 0);
  };
  D.monthName = (c) => ({ 9: 'September', 10: 'October', 11: 'November' }[MON[String(c.date).split(' ')[1]]] || 'Earlier');

  /* Library-only call facts (status cell, sensitivity, audio retention) */
  D.callExtra = {
    'c-vendor': { audioDeleted: false },
    'c-qa': { archivePending: true },
    'c-installer': { audioDeleted: true, audioDeletedOn: '15 Nov' },
  };

  /* Search results (core: hybrid search, strong/weak) */
  D.libSearch = {
    websocket: {
      count: 12,
      crossLang: 'Russian query matched English transcripts too',
      topic: 't-ws',
      items: ['d-notif', 'q-reconnect', 'i-replay'],
      how: { words: 'websocket, уведомлени- (Russian stems)', meaning: 'on', languages: 'all' },
      transcripts: [
        { callId: 'c-backend', more: 4, extra: [
          { t: '00:44:30', speaker: 'p-dmitri', lang: 'RU', text: 'Replay buffer для [[websocket]] сделаем на бэкенде.' },
          { t: '00:45:02', speaker: 'p-you', lang: 'EN', text: 'Who writes the acceptance criteria for the [[websocket]] reconnect?' },
          { t: '00:46:15', speaker: 'p-oleg', lang: 'RU', text: 'QA проверит [[уведомления]] после reconnect.' },
          { t: '00:47:40', speaker: 'p-dmitri', lang: 'EN', text: 'The [[notification]] service already dedupes by event id.' },
        ], spans: [
          { t: '00:41:10', speaker: 'p-dmitri', lang: 'RU', text: 'Договорились: drawer слушает [[notification service]], а не [[websocket]] напрямую.' },
          { t: '00:43:52', speaker: 'p-oleg', lang: 'EN', text: '…the [[websocket]] reconnect needs a replay buffer before QA can sign off.' },
        ] },
        { callId: 'c-live', more: 0, spans: [
          { t: '00:21:12', speaker: 'p-dmitri', lang: 'RU', text: '[[Websocket уведомления]] идут через notification service, как решили второго октября.' },
          { t: '00:23:40', speaker: 'p-dmitri', lang: 'EN', text: 'I will add a replay buffer for [[websocket]] reconnects on the backend, VSTOR-9912.' },
        ] },
      ],
      weak: [
        { callId: 'c-design', more: 0, spans: [
          { t: '00:12:40', speaker: 'p-lena', lang: 'DE', text: 'Die Benachrichtigungen im Panel sollten nach Quelle gruppiert werden.', weak: true },
        ] },
      ],
      docs: [
        { title: 'Drawer spec', source: 'Confluence', icon: 'doc', path: 'Drawer spec › § 3 Event delivery', snippet: '…events reach the drawer over the [[websocket]] and are replayed after a reconnect…', fresh: 'indexed last night' },
        { title: 'Notification service API', source: '~/Documents/Specs', icon: 'folder', path: 'notification-service.md › Delivery guarantees', snippet: 'At-least-once delivery to every [[websocket]] subscriber; clients deduplicate by event id.', fresh: 'indexed today 08:41', weak: true },
      ],
    },
    vstor: {
      count: 3,
      keywordOnly: true,
      items: ['i-replay'],
      how: { words: 'VSTOR-9912 (exact)', meaning: 'off while the index rebuilds', languages: 'all' },
      transcripts: [
        { callId: 'c-live', more: 0, spans: [
          { t: '00:22:41', speaker: 'p-dmitri', lang: 'EN', text: 'I will add a replay buffer on the backend, [[VSTOR-9912]].' },
        ] },
      ],
      weak: [],
      docs: [],
    },
    weakOnly: {
      count: 4,
      allWeak: true,
      items: [],
      how: { words: 'übergab-, schnittstell- (German stems)', meaning: 'on', languages: 'all' },
      transcripts: [],
      weak: [
        { callId: 'c-installer', more: 0, spans: [
          { t: '00:14:02', speaker: 'p-lena', lang: 'DE', text: 'Wir sollten die API-Grenze zum Installer sauber dokumentieren.', weak: true },
        ] },
        { callId: 'c-qa', more: 0, spans: [
          { t: '00:12:05', speaker: 'p-oleg', lang: 'RU', text: 'Чеклист передачи для QA будет ко вторнику.', weak: true },
        ] },
      ],
      docs: [
        { title: 'Installer handover', source: 'Confluence', icon: 'doc', path: 'Installer › Handover to QA', snippet: 'The installer team hands the license check over to QA with a test matrix.', fresh: 'indexed last night', weak: true },
      ],
    },
  };

  /* Ask: canned answers keyed by topic of the question */
  D.askAnswers = {
    websocket: {
      paras: [
        'On 2 October the backend sync agreed that the drawer listens to the notification service and not to the websocket directly [1]. Dmitri S. reaffirmed this in today\'s planning call [2] and will add a replay buffer for reconnects, tracked as VSTOR-9912 [3].',
        'Still open: who owns the acceptance criteria for the reconnect handling [4]. The Drawer spec describes event delivery over the websocket with replay after a reconnect [5].',
      ],
      meta: 'Answered from 3 calls and 1 document · 2 lookups · 6.2 s · nothing from the model\'s own knowledge',
      citations: [
        { n: 1, kind: 'call', callId: 'c-backend', speaker: 'p-dmitri', t: '00:41:10', lang: 'RU', quote: 'Договорились: drawer слушает notification service, а не websocket напрямую.' },
        { n: 2, kind: 'call', callId: 'c-live', speaker: 'p-dmitri', t: '00:21:12', lang: 'RU', quote: 'Websocket уведомления идут через notification service, как решили второго октября.' },
        { n: 3, kind: 'call', callId: 'c-live', speaker: 'p-dmitri', t: '00:22:41', lang: 'EN', quote: 'I will add a replay buffer on the backend, VSTOR-9912.', suggested: true },
        { n: 4, kind: 'call', callId: 'c-live', speaker: 'p-pavel', t: '00:21:40', lang: 'EN', quote: 'Then who writes the acceptance criteria for the reconnect handling?' },
        { n: 5, kind: 'doc', title: 'Drawer spec', source: 'Confluence', section: '§ 3 Event delivery', fresh: 'indexed source, last synced last night' },
      ],
    },
    anna: {
      paras: [
        'Anna K. committed to the drawer redesign spec by Friday 17 October, first in your 1:1 on 9 October [1] and again in today\'s planning call [2]. She also offered to check the drawer focus order with VoiceOver; that item is still suggested and not reviewed [3].',
        'She asked you for an answer on the conference budget [4].',
      ],
      meta: 'Answered from 2 calls · 0 lookups · 4.1 s · nothing from the model\'s own knowledge',
      citations: [
        { n: 1, kind: 'call', callId: 'c-1on1-anna-9', speaker: 'p-anna', t: '00:12:30', lang: 'RU', quote: 'Спеку по drawer пришлю к пятнице.' },
        { n: 2, kind: 'call', callId: 'c-live', speaker: 'p-anna', t: '00:19:58', lang: 'RU', quote: 'Я сделаю drawer redesign до пятницы.' },
        { n: 3, kind: 'call', callId: 'c-live', speaker: 'p-anna', t: '00:35:02', lang: 'EN', quote: 'I can check the focus order with VoiceOver on Monday.', suggested: true },
        { n: 4, kind: 'call', callId: 'c-1on1-anna-9', speaker: 'p-anna', t: '00:24:10', lang: 'EN', quote: 'Can you tell me by Friday whether the conference budget is approved?' },
      ],
    },
    openstack: {
      paras: ['On 1 October you decided to upgrade OpenStack in two steps, staging first, with Pavel owning the migration plan VSTOR-9841 [1]. The plan is due today [2].'],
      meta: 'Answered from 1 call · 1 lookup · 3.4 s · nothing from the model\'s own knowledge',
      citations: [
        { n: 1, kind: 'call', callId: 'c-openstack', speaker: 'p-dmitri', t: '00:38:02', lang: 'EN', quote: 'Let\'s do staging first and production two weeks later.' },
        { n: 2, kind: 'lookup', title: 'Jira VSTOR-9841', section: 'Due 16 Oct · In Progress', fresh: 'live lookup at 14:32' },
      ],
    },
    qa: {
      weak: true,
      paras: ['QA may have promised a handover checklist for Tuesday 21 October [1], and the installer review mentions documenting the boundary to QA [2]. Neither call says this in so many words.'],
      meta: 'Answered from 2 calls · weak matches only',
      citations: [
        { n: 1, kind: 'call', callId: 'c-qa', speaker: 'p-oleg', t: '00:12:05', lang: 'RU', quote: 'Чеклист передачи для QA будет ко вторнику.', weak: true },
        { n: 2, kind: 'call', callId: 'c-installer', speaker: 'p-lena', t: '00:14:02', lang: 'DE', quote: 'Wir sollten die API-Grenze zum Installer sauber dokumentieren.', weak: true, noAudio: true },
      ],
    },
    retentionLocal: {
      local: true,
      paras: ['Markus W. said MonitorCo keeps raw monitoring data for 30 days and aggregates for 13 months [1]. He promised to confirm this in writing; that action item is yours to chase [2].'],
      meta: 'Answered by the local model from 1 call · 0 lookups · 11.8 s · nothing from the model\'s own knowledge',
      citations: [
        { n: 1, kind: 'call', callId: 'c-vendor', speaker: 'p-markus', t: '00:17:20', lang: 'DE', quote: 'Rohdaten behalten wir 30 Tage, Aggregate 13 Monate.' },
        { n: 2, kind: 'call', callId: 'c-vendor', speaker: 'p-you', t: '00:18:02', lang: 'EN', quote: 'Could you send that to me in writing?' },
      ],
    },
  };
  D.askSuggestions = [
    'What did Anna commit to in the last three 1:1s?',
    'What is still open from the planning call on 16 Oct?',
    'What did we decide about the notification service?',
  ];
  D.askRecent = [
    { group: 'Today', q: 'What did we agree with backend about the websocket notifications, and what is open?', key: 'websocket' },
    { group: 'Today', q: 'Open items for Anna before our 1:1', key: 'anna' },
    { group: 'Last week', q: 'What did we decide about the OpenStack upgrade?', key: 'openstack' },
    { group: 'Last week', q: 'What did QA promise about the handover checklist?', key: 'qa' },
  ];

  /* People list facts */
  D.peopleFacts = {
    'p-anna': { theirOpen: 3, youOwe: 1, lastCall: 'Today', sub: 'Frontend · 31 calls since Sep · 1:1 weekly', langs: 'Russian 71 % · English 26 % · German 3 %', voiceSince: '3 Oct', voiceDetail: '2 profiles matched in 28 calls' },
    'p-dmitri': { theirOpen: 2, youOwe: 1, lastCall: 'Today', sub: 'Backend lead · 18 calls since Sep', langs: 'Russian 64 % · English 36 %', voiceSince: '28 Sep', voiceDetail: '1 profile matched in 15 calls' },
    'p-pavel': { theirOpen: 1, youOwe: 2, lastCall: 'Today', sub: 'Product manager · 22 calls since Sep', langs: 'English 90 % · Russian 10 %' },
    'p-oleg': { theirOpen: 2, youOwe: 0, lastCall: '6 Oct', sub: 'QA engineer · 9 calls since Sep', langs: 'Russian 88 % · English 12 %' },
    'p-lena': { theirOpen: 1, youOwe: 0, lastCall: '8 Oct', sub: 'Designer · 7 calls since Sep', langs: 'German 58 % · English 42 %' },
    'p-markus': { theirOpen: 0, youOwe: 1, lastCall: '7 Oct', sub: 'Vendor account manager · MonitorCo · 2 calls', langs: 'German 70 % · English 30 %' },
  };
  D.unnamedVoices = [
    { id: 'u-2', label: 'Speaker 2', calls: 3, last: '9 Oct', sample: '“Fast, ja. Der Kanal ist da, aber…”', lang: 'de' },
    { id: 'u-4', label: 'Speaker 4', calls: 1, last: '13 Oct', sample: '“Хорошо, тогда я посмотрю логи.”', lang: 'ru' },
  ];

  /* Items the user owes people ("Asked you") */
  const asks = [
    { id: 'i-ask-budget', kind: 'action', text: 'Answer on the conference budget', owner: 'p-you', askedBy: 'p-anna', due: 'Fri 17 Oct', status: 'open', review: 'accepted', callId: 'c-1on1-anna-9', span: '00:24:10', lang: 'en' },
    { id: 'i-ask-staging', kind: 'action', text: 'Give Dmitri access to the staging cluster', owner: 'p-you', askedBy: 'p-dmitri', due: 'Mon 20 Oct', status: 'open', review: 'accepted', callId: 'c-backend', span: '00:48:12', lang: 'en' },
    { id: 'i-ask-scope', kind: 'action', text: 'Confirm the release scope for VHI 8.0', owner: 'p-you', askedBy: 'p-pavel', due: 'Fri 17 Oct', status: 'open', review: 'accepted', callId: 'c-live', span: '00:40:30', lang: 'en' },
  ];
  asks.forEach((a) => { if (!D.items.find((i) => i.id === a.id)) D.items.push(a); });

  /* Topic thread facts */
  D.topicExtra = {
    't-drawer': { since: '2 Sep', last: 'Today' },
    't-ws': { since: '2 Sep', last: 'Today' },
    't-notif': { since: '8 Sep', last: '8 Oct' },
    't-license': { since: '29 Sep', last: '6 Oct' },
    't-openstack': { since: '15 Sep', last: '1 Oct' },
    't-retention': { since: '7 Oct', last: '7 Oct' },
  };
})();
