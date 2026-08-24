//! Frame statistics: rolling build-time samples with percentile queries.
//!
//! Pure logic, no gpui types — the overlay and the wire `getStats` command
//! both read from here. Samples are build durations of the retained-tree walk
//! (the cost this architecture owns); layout/paint belong to gpui.

use std::time::Duration;

/// Ring buffer capped at [`FrameStats::CAPACITY`] samples.
#[derive(Debug)]
pub struct FrameStats {
    samples: Vec<Duration>,
    next: usize,
    total_pushed: u64,
}

impl FrameStats {
    /// Enough samples for stable percentiles without unbounded growth.
    pub const CAPACITY: usize = 512;

    pub fn new() -> Self {
        FrameStats {
            samples: Vec::with_capacity(Self::CAPACITY),
            next: 0,
            total_pushed: 0,
        }
    }

    pub fn push(&mut self, duration: Duration) {
        if self.samples.len() < Self::CAPACITY {
            self.samples.push(duration);
        } else {
            self.samples[self.next] = duration;
        }
        self.next = (self.next + 1) % Self::CAPACITY;
        self.total_pushed += 1;
    }

    pub fn frames(&self) -> u64 {
        self.total_pushed
    }

    /// Wire-facing accessors for the S7b `getStats` command; unused until then.
    #[allow(dead_code)]
    pub fn len(&self) -> usize {
        self.samples.len()
    }

    #[allow(dead_code)]
    pub fn is_empty(&self) -> bool {
        self.samples.is_empty()
    }

    /// Percentile in 0.0..=1.0 (nearest-rank on the sorted sample window).
    /// Empty stats yield `None`.
    pub fn percentile(&self, p: f64) -> Option<Duration> {
        if self.samples.is_empty() || !(0.0..=1.0).contains(&p) {
            return None;
        }
        let mut sorted = self.samples.clone();
        sorted.sort();
        // Nearest-rank: index = ceil(p * n), clamped to the last element.
        let rank = ((p * sorted.len() as f64).ceil() as usize).clamp(1, sorted.len());
        Some(sorted[rank - 1])
    }

    #[allow(dead_code)]
    pub fn max(&self) -> Option<Duration> {
        self.samples.iter().max().copied()
    }

    /// The most recently pushed sample (before any ring overwrite). Empty
    /// stats yield `None`.
    pub fn last(&self) -> Option<Duration> {
        if self.samples.is_empty() {
            return None;
        }
        let idx = (self.next + Self::CAPACITY - 1) % Self::CAPACITY;
        self.samples.get(idx).copied()
    }
}

impl Default for FrameStats {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_stats_have_no_percentiles() {
        let stats = FrameStats::new();
        assert!(stats.is_empty());
        assert_eq!(stats.percentile(0.95), None);
        assert_eq!(stats.max(), None);
        assert_eq!(stats.frames(), 0);
    }

    #[test]
    fn single_sample_is_every_percentile() {
        let mut stats = FrameStats::new();
        stats.push(Duration::from_millis(5));
        for p in [0.0, 0.5, 0.95, 1.0] {
            assert_eq!(stats.percentile(p), Some(Duration::from_millis(5)));
        }
    }

    #[test]
    fn percentile_rejects_out_of_range_p() {
        let mut stats = FrameStats::new();
        stats.push(Duration::from_millis(1));
        assert_eq!(stats.percentile(-0.1), None);
        assert_eq!(stats.percentile(1.5), None);
    }

    #[test]
    fn known_distribution_nearest_rank() {
        let mut stats = FrameStats::new();
        // 100 samples: 1ms..=100ms (sorted by construction).
        for ms in 1..=100u64 {
            stats.push(Duration::from_millis(ms));
        }
        assert_eq!(stats.percentile(0.5), Some(Duration::from_millis(50)));
        assert_eq!(stats.percentile(0.90), Some(Duration::from_millis(90)));
        assert_eq!(stats.percentile(0.95), Some(Duration::from_millis(95)));
        assert_eq!(stats.percentile(1.0), Some(Duration::from_millis(100)));
        assert_eq!(stats.max(), Some(Duration::from_millis(100)));
        assert_eq!(stats.frames(), 100);
    }

    #[test]
    fn ring_overwrites_oldest_after_capacity() {
        let mut stats = FrameStats::new();
        for ms in 1..=(FrameStats::CAPACITY as u64 + 100) {
            stats.push(Duration::from_millis(ms));
        }
        assert_eq!(stats.len(), FrameStats::CAPACITY);
        assert_eq!(stats.frames(), FrameStats::CAPACITY as u64 + 100);
        // Oldest 100 samples were overwritten; the minimum remaining is 101ms,
        // so p50 must be well above the discarded range's midpoint.
        let p50 = stats.percentile(0.5).unwrap();
        assert!(p50 > Duration::from_millis(150), "p50 = {p50:?}");
        assert_eq!(
            stats.max(),
            Some(Duration::from_millis(FrameStats::CAPACITY as u64 + 100))
        );
    }

    #[test]
    fn unsorted_input_still_ranks_correctly() {
        let mut stats = FrameStats::new();
        for ms in [30u64, 10, 20, 40, 50] {
            stats.push(Duration::from_millis(ms));
        }
        assert_eq!(stats.percentile(0.5), Some(Duration::from_millis(30)));
        assert_eq!(stats.percentile(0.9), Some(Duration::from_millis(50)));
    }

    #[test]
    fn last_returns_most_recent_sample_across_wraparound() {
        let mut stats = FrameStats::new();
        for ms in 1..=(FrameStats::CAPACITY as u64 + 7) {
            stats.push(Duration::from_millis(ms));
        }
        assert_eq!(
            stats.last(),
            Some(Duration::from_millis(FrameStats::CAPACITY as u64 + 7))
        );
    }
}
