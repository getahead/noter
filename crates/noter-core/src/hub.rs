//! The stream hub: per stream a sequence and a bounded replay buffer, per subscription its
//! Channel and the last acknowledged `seq` (DESIGN-core › Stream hub). One hub per message type.

// @cpt-component:cpt-noter-component-core-stream-hub:p1

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use noter_protocol::ipc::Sink;
use noter_protocol::model::{StreamEndReason, WindowLabel};
use noter_protocol::{CoreError, Seq, SubscriptionId};

use crate::Clock;

/// Unacknowledged messages at which a subscription ends `lagged`; also the replay bound.
pub const LAG_LIMIT: u64 = 2000;

/// A Channel message type: it carries its stream's `seq`, and may have an `ended` form.
pub trait StreamMsg: Clone + Send + 'static {
    fn set_seq(&mut self, seq: Seq);
    /// The message that ends a subscription, or `None` when the type has none (levels).
    fn ended(reason: StreamEndReason) -> Option<Self>;
}

/// What a subscribing command returns: the service's snapshot and where the Channel starts.
#[derive(Debug, Clone, PartialEq)]
pub struct Subscribed<S> {
    pub snapshot: S,
    pub last_seq: Seq,
    pub subscription_id: SubscriptionId,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SubState {
    Registering,
    Streaming,
    Ended,
}

struct Sub<M> {
    id: SubscriptionId,
    window: Option<WindowLabel>,
    sink: Sink<M>,
    acked: u64,
    state: SubState,
}

impl<M: StreamMsg> Sub<M> {
    // @cpt-state:cpt-noter-state-core-ipc-host-subscription:p1
    fn advance(&mut self, next: SubState) {
        use SubState::*;
        let allowed = matches!(
            (self.state, next),
            (Registering, Streaming) | (Streaming, Ended)
        );
        debug_assert!(
            allowed,
            "subscription {:?} cannot become {next:?}",
            self.state
        );
        self.state = next;
    }

    /// The window gets `ended { reason }` (when the type has one) and nothing after it.
    fn end(&mut self, reason: StreamEndReason, last_seq: u64) {
        // @cpt-begin:cpt-noter-state-core-ipc-host-subscription:p1:inst-st-ended
        self.advance(SubState::Ended);
        // @cpt-end:cpt-noter-state-core-ipc-host-subscription:p1:inst-st-ended
        if let Some(mut msg) = M::ended(reason) {
            msg.set_seq(Seq(last_seq + 1));
            self.sink.send(msg);
        }
    }
}

struct Stream<M> {
    seq: u64,
    replay: VecDeque<(u64, M)>,
    subs: Vec<Sub<M>>,
    /// When the last message went out, for a coalesced stream (levels).
    last_sent_ms: Option<i64>,
}

impl<M: StreamMsg> Stream<M> {
    fn new() -> Self {
        Stream {
            seq: 0,
            replay: VecDeque::new(),
            subs: Vec::new(),
            last_sent_ms: None,
        }
    }

    fn end_where(&mut self, pick: impl Fn(&Sub<M>) -> bool, reason: StreamEndReason) {
        let seq = self.seq;
        self.subs.retain_mut(|sub| {
            if pick(sub) {
                sub.end(reason, seq);
            }
            !pick(sub)
        });
    }
}

static NEXT_SUBSCRIPTION: AtomicU64 = AtomicU64::new(1);

/// The streams of one message type (transcript, cards, levels, self-test, …), keyed by stream
/// (for example a call id).
// @cpt-dod:cpt-noter-dod-core-ipc-host-stream-hub:p1
pub struct StreamHub<M: StreamMsg> {
    streams: Mutex<HashMap<String, Stream<M>>>,
    clock: Arc<dyn Clock>,
    /// At most one message per this many ms per stream (levels); `None` sends every one.
    coalesce_ms: Option<i64>,
}

impl<M: StreamMsg> StreamHub<M> {
    pub fn new(clock: Arc<dyn Clock>, coalesce_ms: Option<i64>) -> Self {
        StreamHub {
            streams: Mutex::new(HashMap::new()),
            clock,
            coalesce_ms,
        }
    }

    fn lock(&self) -> MutexGuard<'_, HashMap<String, Stream<M>>> {
        self.streams
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Takes the service's snapshot and registers the Channel under one lock, so the Channel
    /// starts at `last_seq + 1`. The snapshot reads through the writer connection
    /// (`Store::read_snapshot`); a failed snapshot registers nothing.
    // @cpt-algo:cpt-noter-algo-core-ipc-host-subscribe:p1
    pub fn subscribe<S>(
        &self,
        key: &str,
        window: Option<WindowLabel>,
        sink: Sink<M>,
        snapshot: impl FnOnce() -> Result<S, CoreError>,
    ) -> Result<Subscribed<S>, CoreError> {
        // @cpt-begin:cpt-noter-algo-core-ipc-host-subscribe:p1:inst-lock
        let mut streams = self.lock();
        // @cpt-end:cpt-noter-algo-core-ipc-host-subscribe:p1:inst-lock
        // @cpt-begin:cpt-noter-algo-core-ipc-host-subscribe:p1:inst-snapshot
        let snapshot = snapshot()?;
        // @cpt-end:cpt-noter-algo-core-ipc-host-subscribe:p1:inst-snapshot
        // @cpt-begin:cpt-noter-algo-core-ipc-host-subscribe:p1:inst-read-seq
        let stream = streams.entry(key.to_owned()).or_insert_with(Stream::new);
        let last_seq = stream.seq;
        // @cpt-end:cpt-noter-algo-core-ipc-host-subscribe:p1:inst-read-seq
        // @cpt-begin:cpt-noter-algo-core-ipc-host-subscribe:p1:inst-register
        let id = SubscriptionId::new(format!(
            "sub_{}",
            NEXT_SUBSCRIPTION.fetch_add(1, Ordering::Relaxed)
        ));
        let mut sub = Sub {
            id: id.clone(),
            window,
            sink,
            acked: last_seq,
            state: SubState::Registering,
        };
        // @cpt-begin:cpt-noter-state-core-ipc-host-subscription:p1:inst-st-streaming
        sub.advance(SubState::Streaming);
        // @cpt-end:cpt-noter-state-core-ipc-host-subscription:p1:inst-st-streaming
        stream.subs.push(sub);
        // @cpt-end:cpt-noter-algo-core-ipc-host-subscribe:p1:inst-register
        // @cpt-begin:cpt-noter-algo-core-ipc-host-subscribe:p1:inst-unlock
        drop(streams);
        // @cpt-end:cpt-noter-algo-core-ipc-host-subscribe:p1:inst-unlock
        // @cpt-begin:cpt-noter-algo-core-ipc-host-subscribe:p1:inst-return-subscribe
        Ok(Subscribed {
            snapshot,
            last_seq: Seq(last_seq),
            subscription_id: id,
        })
        // @cpt-end:cpt-noter-algo-core-ipc-host-subscribe:p1:inst-return-subscribe
    }

    /// Sends the next message of a stream to every subscription; returns its `seq` (on a
    /// coalesced stream, a message within the interval is dropped and the last `seq` returned).
    ///
    /// Services publish only after their write returned, so a reload never misses a committed
    /// record. Sinks run under the hub lock: they must not call back into the core or the hub.
    // @cpt-algo:cpt-noter-algo-core-ipc-host-ack:p1
    pub fn publish(&self, key: &str, mut msg: M) -> Seq {
        let now = self.coalesce_ms.map(|_| self.clock.now().0);
        // @cpt-begin:cpt-noter-algo-core-ipc-host-ack:p1:inst-publish
        let mut streams = self.lock();
        let stream = streams.entry(key.to_owned()).or_insert_with(Stream::new);
        // @cpt-begin:cpt-noter-algo-core-ipc-host-ack:p1:inst-coalesce
        if let (Some(gap), Some(now), Some(last)) = (self.coalesce_ms, now, stream.last_sent_ms) {
            if now - last < gap {
                return Seq(stream.seq); // before a seq is taken: every subscriber stays gapless
            }
        }
        stream.last_sent_ms = now;
        // @cpt-end:cpt-noter-algo-core-ipc-host-ack:p1:inst-coalesce
        stream.seq += 1;
        let seq = stream.seq;
        msg.set_seq(Seq(seq));
        if stream.replay.len() as u64 == LAG_LIMIT {
            stream.replay.pop_front();
        }
        stream.replay.push_back((seq, msg.clone()));
        // @cpt-end:cpt-noter-algo-core-ipc-host-ack:p1:inst-publish
        // @cpt-begin:cpt-noter-algo-core-ipc-host-ack:p1:inst-for-subs
        stream.subs.retain_mut(|sub| {
            // @cpt-begin:cpt-noter-flow-core-ipc-host-window-open:p1:inst-deliver
            if !sub.sink.send(msg.clone()) {
                sub.advance(SubState::Ended);
                return false;
            }
            // @cpt-end:cpt-noter-flow-core-ipc-host-window-open:p1:inst-deliver
            // @cpt-begin:cpt-noter-algo-core-ipc-host-ack:p1:inst-end-lagged
            if seq - sub.acked >= LAG_LIMIT {
                sub.end(StreamEndReason::Lagged, seq);
                return false;
            }
            // @cpt-end:cpt-noter-algo-core-ipc-host-ack:p1:inst-end-lagged
            true
        });
        // @cpt-end:cpt-noter-algo-core-ipc-host-ack:p1:inst-for-subs
        // @cpt-begin:cpt-noter-algo-core-ipc-host-ack:p1:inst-return-publish
        Seq(seq)
        // @cpt-end:cpt-noter-algo-core-ipc-host-ack:p1:inst-return-publish
    }

    /// `stream_ack`: false when no live subscription has this id.
    pub fn ack(&self, id: &SubscriptionId, seq: Seq) -> bool {
        let mut streams = self.lock();
        let sub = streams
            .values_mut()
            .flat_map(|s| s.subs.iter_mut())
            .find(|s| &s.id == id);
        // @cpt-begin:cpt-noter-algo-core-ipc-host-ack:p1:inst-ack-update
        sub.map(|sub| sub.acked = sub.acked.max(seq.0)).is_some()
        // @cpt-end:cpt-noter-algo-core-ipc-host-ack:p1:inst-ack-update
    }

    /// `stream_unsubscribe`: ends it with `unsubscribed`; false when it was already gone.
    pub fn unsubscribe(&self, id: &SubscriptionId) -> bool {
        let mut streams = self.lock();
        let Some(stream) = streams
            .values_mut()
            .find(|s| s.subs.iter().any(|sub| &sub.id == id))
        else {
            return false;
        };
        stream.end_where(|sub| &sub.id == id, StreamEndReason::Unsubscribed);
        true
    }

    /// A webview loaded a page or was destroyed: its subscriptions end.
    pub fn end_webview(&self, label: WindowLabel) {
        self.reset(Reset::Webview(label));
    }

    /// A stream ended (call stopped, discarded): its subscriptions end with that reason.
    pub fn end_stream(&self, key: &str, reason: StreamEndReason) {
        self.reset(Reset::Streams(Some(key), reason));
    }

    /// Every stream ends (shutdown).
    pub fn end_all(&self, reason: StreamEndReason) {
        self.reset(Reset::Streams(None, reason));
    }

    // @cpt-algo:cpt-noter-algo-core-ipc-host-webview-reset:p1
    fn reset(&self, what: Reset<'_>) {
        let mut streams = self.lock();
        match what {
            // @cpt-begin:cpt-noter-algo-core-ipc-host-webview-reset:p1:inst-if-webview
            Reset::Webview(label) => {
                // @cpt-begin:cpt-noter-algo-core-ipc-host-webview-reset:p1:inst-end-webview
                for stream in streams.values_mut() {
                    stream.end_where(
                        |sub| sub.window == Some(label),
                        StreamEndReason::Unsubscribed,
                    );
                }
                // @cpt-end:cpt-noter-algo-core-ipc-host-webview-reset:p1:inst-end-webview
            }
            // @cpt-end:cpt-noter-algo-core-ipc-host-webview-reset:p1:inst-if-webview
            // @cpt-begin:cpt-noter-algo-core-ipc-host-webview-reset:p1:inst-if-stream-end
            Reset::Streams(key, reason) => {
                // @cpt-begin:cpt-noter-algo-core-ipc-host-webview-reset:p1:inst-end-stream
                for (_, stream) in streams
                    .iter_mut()
                    .filter(|(k, _)| key.map_or(true, |key| key == k.as_str()))
                {
                    stream.end_where(|_| true, reason);
                }
                // @cpt-end:cpt-noter-algo-core-ipc-host-webview-reset:p1:inst-end-stream
            } // @cpt-end:cpt-noter-algo-core-ipc-host-webview-reset:p1:inst-if-stream-end
        }
        // @cpt-begin:cpt-noter-algo-core-ipc-host-webview-reset:p1:inst-return-reset
        drop(streams);
        // @cpt-end:cpt-noter-algo-core-ipc-host-webview-reset:p1:inst-return-reset
    }

    /// The buffered messages of a stream after `seq` (at most `LAG_LIMIT`, oldest first).
    pub fn replay_after(&self, key: &str, seq: Seq) -> Vec<M> {
        let streams = self.lock();
        let Some(stream) = streams.get(key) else {
            return vec![];
        };
        stream
            .replay
            .iter()
            .filter(|(s, _)| *s > seq.0)
            .map(|(_, m)| m.clone())
            .collect()
    }
}

enum Reset<'a> {
    Webview(WindowLabel),
    Streams(Option<&'a str>, StreamEndReason),
}

/// A hub as the core routes commands to it, whatever its message type.
pub(crate) trait AnyHub: Send + Sync {
    fn ack(&self, id: &SubscriptionId, seq: Seq) -> bool;
    fn unsubscribe(&self, id: &SubscriptionId) -> bool;
    fn end_webview(&self, label: WindowLabel);
    fn end_all(&self, reason: StreamEndReason);
}

impl<M: StreamMsg> AnyHub for StreamHub<M> {
    fn ack(&self, id: &SubscriptionId, seq: Seq) -> bool {
        StreamHub::ack(self, id, seq)
    }
    fn unsubscribe(&self, id: &SubscriptionId) -> bool {
        StreamHub::unsubscribe(self, id)
    }
    fn end_webview(&self, label: WindowLabel) {
        StreamHub::end_webview(self, label)
    }
    fn end_all(&self, reason: StreamEndReason) {
        StreamHub::end_all(self, reason)
    }
}
