import Foundation
import XCTest

@testable import NoterEngineKit

private final class ReplayProbe: @unchecked Sendable {
    let entered = DispatchSemaphore(value: 0)
    let release = DispatchSemaphore(value: 0)
    private let lock = NSLock()
    private let at: Int
    private let gated: Bool
    private var reads = 0
    private var stopCount = 0
    private var positions: [(Int, Bool)] = []

    init(at: Int, gated: Bool = false) { self.at = at; self.gated = gated }
    var stops: Int { lock.withLock { stopCount } }
    var playing: [Bool] { lock.withLock { positions.map(\.1) } }

    func head() -> Int {
        let first = lock.withLock { reads += 1; return reads == 1 }
        if gated && first {
            entered.signal()
            release.wait()
        }
        return at
    }

    func stop() { lock.withLock { stopCount += 1 } }
    func position(_ at: Int, _ playing: Bool) { lock.withLock { positions.append((at, playing)) } }
}

/// Retains cancelled handlers too: cancellation cannot interrupt an already executing timer callback.
private final class ReplayTimers: @unchecked Sendable {
    private let lock = NSLock()
    private var handlers: [@Sendable () -> Void] = []
    private var cancelled: Set<Int> = []

    func schedule(_ handler: @escaping @Sendable () -> Void) -> () -> Void {
        let id = lock.withLock { let id = handlers.count; handlers.append(handler); return id }
        return { _ = self.lock.withLock { self.cancelled.insert(id) } }
    }

    func fire(_ id: Int) { lock.withLock { handlers[id] }() }
    func isCancelled(_ id: Int) -> Bool { lock.withLock { cancelled.contains(id) } }
}

final class ReplayTests: XCTestCase {
    func testTheCurrentTimerReportsProgressAndExplicitStopCompletesOnlyOnce() throws {
        let audio = ReplayProbe(at: 5)
        let timers = ReplayTimers()
        let player = FilePlayer(
            prepare: { _, _, _ in FilePlayer.Audio(endMs: 10, head: audio.head, stop: audio.stop) },
            schedule: timers.schedule)
        try player.play([], fromMs: 0, toMs: 10, position: { audio.position($0, $1) })
        timers.fire(0)
        timers.fire(0)
        player.stop()
        player.stop()
        timers.fire(0)
        XCTAssertEqual(audio.playing, [true, true, false])
        XCTAssertEqual(audio.stops, 1)
        XCTAssertTrue(timers.isCancelled(0))
    }

    func testAProgressCallbackCanStopPlayback() throws {
        let audio = ReplayProbe(at: 5)
        let timers = ReplayTimers()
        let player = FilePlayer(
            prepare: { _, _, _ in FilePlayer.Audio(endMs: 10, head: audio.head, stop: audio.stop) },
            schedule: timers.schedule)
        try player.play([], fromMs: 0, toMs: 10) { [weak player] at, playing in
            audio.position(at, playing)
            if playing { player?.stop() }
        }
        let returned = DispatchSemaphore(value: 0)
        DispatchQueue.global().async { timers.fire(0); returned.signal() }
        XCTAssertEqual(returned.wait(timeout: .now() + 5), .success)
        XCTAssertEqual(audio.playing, [true, false])
        XCTAssertEqual(audio.stops, 1)
    }

    func testAnInflightOldTimerCannotCompleteOrPublishProgressForANewPlayback() throws {
        for oldHead in [5, 10] {
            let old = ReplayProbe(at: oldHead, gated: true)
            let next = ReplayProbe(at: 10)
            let timers = ReplayTimers()
            let player = FilePlayer(
                prepare: { files, _, _ in
                    let probe = files[0].lastPathComponent == "old" ? old : next
                    return FilePlayer.Audio(endMs: 10, head: probe.head, stop: probe.stop)
                }, schedule: timers.schedule)
            try player.play([URL(fileURLWithPath: "/old")], fromMs: 0, toMs: 10, position: { old.position($0, $1) })
            let returned = DispatchSemaphore(value: 0)
            DispatchQueue.global().async {
                timers.fire(0)
                returned.signal()
            }
            XCTAssertEqual(old.entered.wait(timeout: .now() + 5), .success)
            try player.play([URL(fileURLWithPath: "/next")], fromMs: 0, toMs: 10, position: { next.position($0, $1) })
            XCTAssertTrue(timers.isCancelled(0))
            XCTAssertEqual(old.stops, 1)
            XCTAssertEqual(old.playing, [false])
            old.release.signal()
            XCTAssertEqual(returned.wait(timeout: .now() + 5), .success)
            XCTAssertEqual(next.stops, 0, "the old boundary callback cannot stop the replacement audio")
            XCTAssertFalse(timers.isCancelled(1))
            XCTAssertEqual(old.playing, [false], "no stale progress after the old playback ended")
            XCTAssertTrue(next.playing.isEmpty)
            timers.fire(1)
            timers.fire(1)
            player.stop()
            XCTAssertEqual(next.stops, 1)
            XCTAssertEqual(next.playing, [false], "the replacement completes exactly once")
        }
    }
}
