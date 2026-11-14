use noter_core::Clock;
use noter_protocol::TimestampMs;

pub struct FixedClock(i64);

impl FixedClock {
    pub fn at(timestamp_ms: i64) -> Self {
        Self(timestamp_ms)
    }
}

impl Clock for FixedClock {
    fn now(&self) -> TimestampMs {
        TimestampMs(self.0)
    }
}
