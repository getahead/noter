//! Civil time for user-facing dates. Stored timestamps remain Unix milliseconds.

use crate::{Core, NativeServices};
use noter_protocol::TimestampMs;

pub(crate) const DAY_MS: i64 = 86_400_000;

#[derive(Clone, Copy)]
pub(crate) struct LocalTime<'a>(&'a dyn NativeServices);

impl Core {
    pub(crate) fn local_time(&self) -> LocalTime<'_> {
        LocalTime(self.deps.native.as_ref())
    }
}

// @cpt-flow:cpt-noter-flow-core-library-calls-list:p1
impl LocalTime<'_> {
    fn offset_minutes(self, ms: i64) -> i64 {
        i64::from(self.0.utc_offset_minutes(TimestampMs(ms)))
    }

    pub(crate) fn wall_ms(self, ms: i64) -> i64 {
        ms.saturating_add(self.offset_minutes(ms) * 60_000)
    }

    pub(crate) fn day(self, ms: i64) -> i64 {
        self.wall_ms(ms).div_euclid(DAY_MS)
    }

    /// First instant of a civil date, even when midnight is skipped or repeated.
    pub(crate) fn start(self, day: i64) -> i64 {
        let midnight = day * DAY_MS;
        let mut low = midnight - DAY_MS;
        let mut high = midnight + DAY_MS;
        let candidate = midnight - self.offset_minutes(low) * 60_000;
        if self.day(candidate) == day && self.day(candidate - 1) < day {
            return candidate;
        }
        while high - low > 1 {
            let mid = low + (high - low) / 2;
            if self.day(mid) < day {
                low = mid;
            } else {
                high = mid;
            }
        }
        high
    }

    pub(crate) fn date(self, ms: i64) -> String {
        date_of(self.wall_ms(ms))
    }

    pub(crate) fn date_time(self, ms: i64) -> String {
        let wall = self.wall_ms(ms);
        format!(
            "{} {:02}:{:02}",
            date_of(wall),
            wall.rem_euclid(DAY_MS) / 3_600_000,
            wall.rem_euclid(3_600_000) / 60_000
        )
    }

    pub(crate) fn iso(self, ms: i64) -> String {
        let offset = self.offset_minutes(ms);
        let wall = ms.saturating_add(offset * 60_000);
        let sign = if offset < 0 { '-' } else { '+' };
        format!(
            "{}T{:02}:{:02}:{:02}.{:03}{sign}{:02}:{:02}",
            date_of(wall),
            wall.rem_euclid(DAY_MS) / 3_600_000,
            wall.rem_euclid(3_600_000) / 60_000,
            wall.rem_euclid(60_000) / 1000,
            wall.rem_euclid(1000),
            offset.abs() / 60,
            offset.abs() % 60
        )
    }
}

/// `YYYY-MM-DD` of a day number (the inverse of the shared retrieval date converter).
fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

pub(crate) fn date_of(ms: i64) -> String {
    let (y, m, d) = civil_from_days(ms.div_euclid(DAY_MS));
    format!("{y:04}-{m:02}-{d:02}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{BoxFuture, EnvironmentReading};
    use noter_protocol::{CoreError, LocalDate, PermissionKind, PermissionState};

    struct OffsetChange {
        at: i64,
        before: i32,
        after: i32,
    }

    impl NativeServices for OffsetChange {
        fn utc_offset_minutes(&self, at: TimestampMs) -> i32 {
            if at.0 < self.at {
                self.before
            } else {
                self.after
            }
        }
        fn permission(&self, _: PermissionKind) -> PermissionState {
            unreachable!()
        }
        fn request_permission(&self, _: PermissionKind) -> BoxFuture<'_, PermissionState> {
            unreachable!()
        }
        fn environment(&self) -> EnvironmentReading {
            unreachable!()
        }
        fn set_login_item(&self, _: bool) -> Result<(), CoreError> {
            unreachable!()
        }
    }

    #[test]
    fn civil_dates_round_trip_even_before_the_epoch_and_on_leap_day() {
        for (ms, date) in [
            (0, "1970-01-01"),
            (-1, "1969-12-31"),
            (1_709_164_800_000, "2024-02-29"),
            (1_709_251_199_999, "2024-02-29"),
        ] {
            assert_eq!(date_of(ms), date);
            assert_eq!(
                crate::library::day_number(&LocalDate(date.into())),
                Some(ms.div_euclid(DAY_MS))
            );
        }
    }

    #[test]
    fn cpt_noter_seq_library_filter_calls_uses_both_local_midnights_across_offset_changes() {
        let hour = 3_600_000;
        // Spring forward at 02:00 local, then fall back at 03:00 local.
        for (before, after) in [(60, 120), (120, 60)] {
            let host = OffsetChange {
                at: hour,
                before,
                after,
            };
            let local = LocalTime(&host);
            assert_eq!(local.start(0), -i64::from(before) * 60_000);
            assert_eq!(local.start(1), DAY_MS - i64::from(after) * 60_000);
            assert_eq!(local.day(local.start(1) - 1), 0);
            assert_eq!(local.day(local.start(1)), 1);
        }
        // A jurisdiction jumping from 23:30 to 00:30 skips the first half hour of day zero.
        let host = OffsetChange {
            at: -hour / 2,
            before: 0,
            after: 60,
        };
        assert_eq!(LocalTime(&host).start(0), -hour / 2);
    }

    #[test]
    fn export_timestamps_preserve_the_offset_and_milliseconds() {
        let host = OffsetChange {
            at: 0,
            before: -210,
            after: 330,
        };
        let local = LocalTime(&host);
        assert_eq!(local.iso(-1), "1969-12-31T20:29:59.999-03:30");
        assert_eq!(local.iso(1), "1970-01-01T05:30:00.001+05:30");
        assert_eq!(local.date_time(-1), "1969-12-31 20:29");
    }
}
