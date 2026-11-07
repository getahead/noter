// Retry helper for the sync client.
pub fn backoff(attempt: u32) -> u64 {
    100 * 2u64.pow(attempt)
}
