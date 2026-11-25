use super::Rule;

pub(super) const RULES: &[Rule] = &[
    Rule {
        id: "one_on_one",
        titles: &[
            "1 on 1",
            "1 на 1",
            "one on one",
            "eins zu eins",
            "один на один",
        ],
        declarations: &[
            "our one on one",
            "наш один на один",
            "unser mitarbeitergespräch",
        ],
        agenda: (
            &["your career goals", "your professional development"],
            &["as your manager", "how can i support you"],
        ),
    },
    Rule {
        id: "standup",
        titles: &["daily", "standup", "stand up", "дейли", "стендап"],
        declarations: &[
            "our standup",
            "our stand up",
            "daily scrum",
            "наш дейли",
            "unser daily",
        ],
        agenda: (
            &[
                "yesterday i",
                "yesterday we",
                "вчера я",
                "я вчера",
                "мы вчера",
                "вчера мы",
                "gestern habe ich",
            ],
            &[
                "today i",
                "today we",
                "my plan for today",
                "сегодня я",
                "я сегодня",
                "план на сегодня",
                "сегодня буду",
                "блокеров нет",
                "heute werde ich",
            ],
        ),
    },
    Rule {
        id: "planning",
        titles: &[
            "planning",
            "grooming",
            "backlog refinement",
            "планирование",
            "sprintplanung",
        ],
        declarations: &[
            "our sprint planning",
            "plan the next sprint",
            "планируем спринт",
            "wir planen den sprint",
        ],
        agenda: (
            &[
                "sprint goal",
                "epic",
                "epics",
                "user stories",
                "цель спринта",
                "бэклог",
                "sprintziel",
            ],
            &[
                "story points",
                "estimates",
                "effort estimate",
                "оценка задач",
                "backlog items",
                "стори поинты",
                "storypunkte",
            ],
        ),
    },
    Rule {
        id: "retro",
        titles: &[
            "retro",
            "retrospective",
            "ретро",
            "ретроспектива",
            "retrospektive",
        ],
        declarations: &[
            "our retrospective",
            "наша ретроспектива",
            "unsere retrospektive",
        ],
        agenda: (
            &["what went well", "что прошло хорошо", "was lief gut"],
            &[
                "what could we improve",
                "what can we improve",
                "what went wrong",
                "что можно улучшить",
                "was können wir verbessern",
            ],
        ),
    },
    Rule {
        id: "cross_team",
        titles: &[
            "cross team",
            "cross functional sync",
            "межкомандный синк",
            "teamübergreifende abstimmung",
        ],
        declarations: &[
            "our cross team sync",
            "наш межкомандный синк",
            "unsere teamübergreifende abstimmung",
        ],
        agenda: (
            &[
                "between our teams",
                "между командами",
                "zwischen unseren teams",
            ],
            &[
                "team dependencies",
                "handoff between",
                "зависимости команд",
                "abhängigkeiten",
            ],
        ),
    },
    Rule {
        id: "vendor",
        titles: &[
            "vendor",
            "supplier",
            "поставщик",
            "с поставщиком",
            "lieferant",
            "lieferantengespräch",
        ],
        declarations: &[
            "our vendor review",
            "supplier review meeting",
            "встреча с поставщиком",
            "unser lieferantengespräch",
        ],
        agenda: (
            &["your proposal", "ваше предложение", "ihr angebot"],
            &["contract renewal", "закупки", "vertragsverlängerung"],
        ),
    },
    Rule {
        id: "interview",
        titles: &[
            "interview",
            "собеседование",
            "vorstellungsgespräch",
            "bewerbungsgespräch",
        ],
        declarations: &[
            "interviewing you",
            "interview for the role",
            "у нас собеседование",
            "zum vorstellungsgespräch",
        ],
        agenda: (
            &[
                "tell me about yourself",
                "расскажите о себе",
                "erzählen sie von sich",
            ],
            &["this role", "на эту должность", "diese stelle"],
        ),
    },
    Rule {
        id: "incident",
        titles: &[
            "incident",
            "outage",
            "war room",
            "инцидент",
            "авария",
            "störungsbehebung",
        ],
        declarations: &[
            "incident bridge",
            "declare an incident",
            "объявляем инцидент",
            "wir haben einen produktionsausfall",
        ],
        agenda: (
            &[
                "production is down",
                "продакшен недоступен",
                "produktion ist ausgefallen",
            ],
            &["roll back", "mitigation", "откат", "rollback"],
        ),
    },
];
