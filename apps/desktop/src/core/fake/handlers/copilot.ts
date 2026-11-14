import * as Bindings from "../../bindings";
import * as Core from "../fake-core";
import { coreError } from "../fake-core";
import * as shared from "./shared";

export function copilotHandlers(fake: Core.FakeCore): Core.Handlers {
  const newId = (prefix: string) => shared.nextId(fake, prefix);
  return {
  // ── Copilot (draft) ──────────────────────────────────────────────────
  cards_subscribe: (a, { world, fake, send }) => {
    const isLive = world.app.capture.call_id === a.call_id && shared.live(world.app.capture);
    const sub = isLive ? newId("sub") : null;
    if (sub) fake.openChannel(sub, "cards_subscribe", send as (m: unknown) => void, 0);
    return {
      subscription_id: sub,
      call_id: a.call_id,
      visible: world.cards.filter((c) => c.call_id === a.call_id && c.number !== null),
      earlier: world.cards.filter((c) => c.call_id === a.call_id && c.number === null),
      pinned: world.items.filter((i) => i.call.id === a.call_id && i.created_by === "pin"),
      status: world.copilot,
      last_seq: 0,
    };
  },
  card_pin: (a, { world, fake }) => {
    const card = shared.findCard(world, a.card_id);
    if (card.state === "expired" || card.state === "dismissed") throw coreError("card_gone");
    const c = shared.call(world, card.call_id);
    const item = shared.blankItem(fake, c, { lang: card.lang, kind: "action_item", text: card.title, created_by: "pin" });
    shared.cardAction(fake, card, item);
    card.state = "pinned";
    world.items.push(item);
    shared.pushCards(fake, { event: { type: "updated", card } });
    return { card, item, change_id: shared.logChange(fake, world, { entity: { kind: "item", id: item.id, label: item.text }, summary: "Pinned a card" }) };
  },
  card_dismiss: (a, { world, fake }) => {
    const card = shared.findCard(world, a.card_id);
    if (card.state === "expired" || card.state === "dismissed") throw coreError("card_gone");
    shared.cardAction(fake, card, null);
    card.state = "dismissed";
    card.number = null;
    shared.pushCards(fake, { event: { type: "removed", card_id: card.id, state: "dismissed" } });
    return { card, item: null, change_id: null };
  },
  card_unpin: (a, { world, fake }) => {
    const card = shared.findCard(world, a.card_id);
    if (card.state !== "pinned") throw coreError("invalid_input", "card is not pinned", { type: "validation", field: "card_id", rule: "invalid_format" });
    const item = world.items.find((i) => i.created_by === "pin" && i.text === card.title) ?? null;
    if (item) world.items = world.items.filter((i) => i !== item);
    card.state = "shown";
    shared.pushCards(fake, { event: { type: "updated", card } });
    return { card, item: null, change_id: item ? shared.logChange(fake, world, { entity: { kind: "item", id: item.id, label: item.text }, summary: "Unpinned a card" }) : null };
  },
  card_undo_last: (a, { world, fake }) => {
    const last = fake.handlerState.lastCardAction;
    const card = last ? world.cards.find((c) => c.id === last.card_id && c.call_id === a.call_id) : undefined;
    if (!last || !card) throw coreError("not_found", "no card action to undo");
    if (shared.now() - last.at > 30_000) throw coreError("undo_expired", "card undo is 30 seconds");
    card.state = last.state;
    card.number = last.number;
    if (last.item_id) world.items = world.items.filter((i) => i.id !== last.item_id);
    fake.handlerState.lastCardAction = null;
    shared.pushCards(fake, { event: { type: "updated", card } });
    return { card, item: null, change_id: null };
  },
  card_set_held: (a, { world }) => {
    const card = shared.findCard(world, a.card_id);
    if (a.held && card.state === "shown") card.state = "held";
    if (!a.held && card.state === "held") card.state = "shown";
    return shared.ack;
  },
  card_rate: (a, { world }) => {
    const card = shared.findCard(world, a.card_id);
    card.rating = a.rating ?? null;
    return { card, item: null, change_id: null };
  },
  card_shown: (a, { world }) => {
    shared.findCard(world, a.card_id);
    return shared.ack;
  },
  copilot_catch_up: (a, { world, fake }) => {
    shared.requireLive(world.app.capture, a.call_id);
    if (world.copilot.muted) throw coreError("copilot_off");
    const card: Bindings.CardView = { ...world.cards[0], id: newId("card"), call_id: a.call_id, number: 1, kind: "catch_up", solicited: true, provenance: null, state: "streaming", title: "Last 5 minutes: drawer scope kept at 480 pt; reconnect owner still open.", created_at: shared.now(), used: false };
    fake.later(800, () => {
      world.cards.unshift(card);
      shared.pushCards(fake, { event: { type: "added", card } });
    });
    return shared.ack;
  },
  copilot_ask_about_call: (a, { world, fake }) => {
    shared.requireLive(world.app.capture, a.call_id);
    if (!a.question.trim()) throw coreError("invalid_input", "question", { type: "validation", field: "question", rule: "required" });
    const card: Bindings.CardView = { ...world.cards[0], id: newId("card"), call_id: a.call_id, number: 1, kind: "answer", solicited: true, state: "shown", title: "Dmitri S. owns the replay buffer (VSTOR-9912).", provenance: { type: "this_call", span: { call_id: a.call_id, channel: "sys", t0_ms: 1_361_000, t1_ms: 1_367_000 } }, created_at: shared.now(), used: false };
    fake.later(1200, () => {
      world.cards.unshift(card);
      shared.pushCards(fake, { event: { type: "added", card } });
    });
    return shared.ack;
  },
  copilot_mute: (a, { fake }) =>
    shared.copilot(fake, (c) => {
      c.muted = a.scope.type === "off" ? null : { scope: a.scope, until: a.scope.type === "for_minutes" ? shared.now() + a.scope.minutes * shared.MIN : null };
      c.card_keys.registered = c.muted === null && shared.live(fake.world.app.capture) && !fake.world.app.presenting.hidden;
    }),
  copilot_mute_agent: (a, { fake }) =>
    shared.copilot(fake, (c) => {
      const row = c.agents.find((x) => x.agent.id === a.agent_id);
      if (!row) throw coreError("not_found", `agent ${a.agent_id}`);
      row.muted = a.muted;
    }),
  copilot_raise_budget: (a, { fake }) =>
    shared.copilot(fake, (c) => {
      const cap = a.cap_usd ?? 0;
      if (!(cap > (c.budget.cap_usd ?? 0))) throw coreError("invalid_input", "cap must go up", { type: "validation", field: "cap_usd", rule: "out_of_range" });
      c.budget.cap_usd = cap;
      c.budget.level = (c.budget.spent_usd ?? 0) > 0.9 * cap ? "near" : "ok";
    }),
  // Screen context chips are v1.x.
  context_chip_set: () => {
    throw coreError("feature_disabled", "screen context chips are v1.x");
  },

  };
}
