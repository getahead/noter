use noter_core::EventEmitter;
use serde_json::Value;
use std::sync::Mutex;

#[derive(Default)]
pub struct Events(Mutex<Vec<(&'static str, Value)>>);

impl EventEmitter for Events {
    fn emit(&self, event: &'static str, payload: Value) {
        self.0.lock().unwrap().push((event, payload));
    }
}

impl Events {
    #[allow(dead_code)] // Not every integration test needs to inspect emitted events.
    pub fn named(&self, name: &str) -> Vec<Value> {
        let mut all = self.0.lock().unwrap();
        let (taken, kept): (Vec<_>, Vec<_>) = std::mem::take(&mut *all)
            .into_iter()
            .partition(|(event, _)| *event == name);
        *all = kept;
        taken.into_iter().map(|(_, payload)| payload).collect()
    }

    #[allow(dead_code)] // Some integration tests inspect all events instead of one name.
    pub fn take(&self) -> Vec<(&'static str, Value)> {
        std::mem::take(&mut *self.0.lock().unwrap())
    }

    #[allow(dead_code)] // Some integration tests assert event ordering by name only.
    pub fn names(&self) -> Vec<&'static str> {
        self.take().into_iter().map(|(name, _)| name).collect()
    }
}
