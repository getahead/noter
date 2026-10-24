// The live channels on one clock: a private aggregate device whose main sub-device is the
// microphone and whose tap list holds a Core Audio process tap (macOS 14.2+) of everything but
// this engine, the app that started it and the excluded apps. One IO proc delivers both, so
// microphone and system audio run on the microphone's clock (the tap is drift-compensated into
// it). The source follows the microphone: unplugged or a new default input, it rebuilds the
// device on the next one and reports the swap.
// shortcut: not exercised by the CI tests (they need the TCC prompts); the M1 week-one runbook
// (`.plans/backend/m1-week-one-runbook.md`) runs it on a Mac and records what it delivers.

import CoreAudio
import Foundation

public final class LiveAudioSource: AudioSource, @unchecked Sendable {
    public struct Failure: Error, CustomStringConvertible {
        public let description: String
    }

    private static let watched = [kAudioHardwarePropertyDefaultInputDevice, kAudioHardwarePropertyDevices]
    private let lock = NSLock()
    private let preferredMic: String?
    private let listeners = DispatchQueue(label: "ai.noter.engine.devices")
    private var excluded: Set<String>
    private var tapDescription: CATapDescription?
    private var tap = AudioObjectID(kAudioObjectUnknown)
    private var device = AudioObjectID(kAudioObjectUnknown)
    private var proc: AudioDeviceIOProcID?
    private var micUID: String?
    private var onChunk: (@Sendable (AudioChunk) -> Void)?
    private var onDevice: (@Sendable (DeviceChange) -> Void)?
    private var listener: AudioObjectPropertyListenerBlock?

    /// `micUid` is the microphone the user chose, or nil for the default input, which is also
    /// the fallback while the chosen one is missing. `bundleIds` are left out of the tap.
    public init(micUid: String? = nil, excluding bundleIds: [String] = []) {
        preferredMic = micUid
        excluded = Set(bundleIds)
    }

    // @cpt-begin:cpt-noter-flow-core-engine-capture-session:p1:inst-open-streams
    public func start(_ onChunk: @escaping @Sendable (AudioChunk) -> Void) throws {
        try lock.withLock {
            self.onChunk = onChunk
            do {
                try createTap()
                try openDevice(mic: try Self.wantedMic(preferredMic)) {}
            } catch {
                close()
                throw error
            }
        }
        listen()
    }
    // @cpt-end:cpt-noter-flow-core-engine-capture-session:p1:inst-open-streams

    public func stop() {
        unlisten()
        lock.withLock {
            close()
            onChunk = nil
        }
    }

    public func observeDevices(_ handler: @escaping @Sendable (DeviceChange) -> Void) {
        lock.withLock { onDevice = handler }
    }

    /// Applies to the running tap at once; processes the app starts later are left out at the
    /// next `start` (resume, or a capture-first restart).
    public func exclude(bundleId: String) throws {
        try lock.withLock {
            excluded.insert(bundleId)
            guard let description = tapDescription, tap != kAudioObjectUnknown else { return }
            description.processes = excludedProcesses()
            var address = Self.address(kAudioTapPropertyDescription)
            var value = description
            let size = UInt32(MemoryLayout<CATapDescription>.size)
            try check(
                withUnsafeMutablePointer(to: &value) { AudioObjectSetPropertyData(tap, &address, 0, nil, size, $0) },
                "leave \(bundleId) out of the tap")
        }
    }

    public var devices: (mic: String, output: String) {
        let mic = lock.withLock { micUID }
        return (mic.flatMap(Self.name(uid:)) ?? "", Self.defaultOutputName() ?? "")
    }

    private func check(_ status: OSStatus, _ what: String) throws {
        if status != noErr { throw Failure(description: "could not \(what) (OSStatus \(status))") }
    }

    /// The engine, the app that started it and the excluded apps' processes (helpers included).
    /// Caller holds the lock.
    private func excludedProcesses() -> [AudioObjectID] {
        // @cpt-begin:cpt-noter-flow-core-engine-capture-replay:p1:inst-play-excluded
        // The engine plays replays itself, so leaving its own process out keeps them out of the recording.
        let own = [getpid(), getppid()].compactMap(Self.processObject)
        // @cpt-end:cpt-noter-flow-core-engine-capture-replay:p1:inst-play-excluded
        return own + Self.processObjects().filter { Exclusion.matches(Self.string($0, kAudioProcessPropertyBundleID) ?? "", excluded) }
    }

    /// Caller holds the lock.
    private func createTap() throws {
        let description = CATapDescription(stereoGlobalTapButExcludeProcesses: excludedProcesses())
        description.uuid = UUID()
        description.isPrivate = true
        description.muteBehavior = .unmuted
        var tap = AudioObjectID(kAudioObjectUnknown)
        try check(AudioHardwareCreateProcessTap(description, &tap), "create the system audio tap")
        (self.tap, tapDescription) = (tap, description)
    }

    /// The aggregate of `mic` and the tap, started after `beforeStart`. Caller holds the lock.
    private func openDevice(mic: String, beforeStart: () -> Void) throws {
        guard let micDevice = Self.device(uid: mic), let tapUID = tapDescription?.uuid.uuidString, let deliver = onChunk
        else { throw Failure(description: "no microphone \(mic)") }
        let aggregate: [String: Any] = [
            kAudioAggregateDeviceNameKey: "Noter capture",
            kAudioAggregateDeviceUIDKey: UUID().uuidString,
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceMainSubDeviceKey: mic,
            kAudioAggregateDeviceSubDeviceListKey: [[kAudioSubDeviceUIDKey: mic]],
            kAudioAggregateDeviceTapAutoStartKey: true,
            kAudioAggregateDeviceTapListKey: [[kAudioSubTapUIDKey: tapUID, kAudioSubTapDriftCompensationKey: true]],
        ]
        var device = AudioObjectID(kAudioObjectUnknown)
        try check(AudioHardwareCreateAggregateDevice(aggregate as CFDictionary, &device), "create the capture device")
        (self.device, micUID) = (device, mic)
        let micBuffers = Self.inputBuffers(micDevice)
        let rate = try Self.sampleRate(device)
        var proc: AudioDeviceIOProcID?
        try check(
            AudioDeviceCreateIOProcIDWithBlock(&proc, device, nil) { _, input, _, _, _ in
                let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: input)).map { b in
                    let count = Int(b.mDataByteSize) / MemoryLayout<Float>.size
                    let samples = b.mData.map { Array(UnsafeBufferPointer(start: $0.assumingMemoryBound(to: Float.self), count: count)) }
                    return (channels: Int(b.mNumberChannels), samples: samples ?? [])
                }
                let (mic, sys) = OneClock.split(buffers, micBuffers: micBuffers)
                if !mic.isEmpty { deliver(AudioChunk(channel: .mic, samples: mic, sampleRate: rate)) }
                if !sys.isEmpty { deliver(AudioChunk(channel: .sys, samples: sys, sampleRate: rate)) }
            }, "install the capture callback")
        self.proc = proc
        beforeStart()
        try check(AudioDeviceStart(device, proc), "start the capture")
    }

    /// Caller holds the lock.
    private func closeDevice() {
        if device != kAudioObjectUnknown {
            if let proc {
                AudioDeviceStop(device, proc)
                AudioDeviceDestroyIOProcID(device, proc)
            }
            AudioHardwareDestroyAggregateDevice(device)
        }
        (device, proc, micUID) = (AudioObjectID(kAudioObjectUnknown), nil, nil)
    }

    /// Caller holds the lock.
    private func close() {
        closeDevice()
        if tap != kAudioObjectUnknown { AudioHardwareDestroyProcessTap(tap) }
        (tap, tapDescription) = (AudioObjectID(kAudioObjectUnknown), nil)
    }

    private func listen() {
        let block: AudioObjectPropertyListenerBlock = { [weak self] _, _ in self?.devicesChanged() }
        lock.withLock { listener = block }
        for selector in Self.watched {
            var address = Self.address(selector)
            AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &address, listeners, block)
        }
    }

    private func unlisten() {
        let block = lock.withLock {
            defer { listener = nil }
            return listener
        }
        guard let block else { return }
        for selector in Self.watched {
            var address = Self.address(selector)
            AudioObjectRemovePropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &address, listeners, block)
        }
    }

    // @cpt-begin:cpt-noter-flow-core-engine-capture-session:p1:inst-open-streams
    /// The microphone went away or the default input moved: capture goes on with the new one.
    private func devicesChanged() {
        guard let mic = try? Self.wantedMic(preferredMic) else { return }
        lock.withLock {
            guard device != kAudioObjectUnknown, mic != micUID else { return }
            let lost = Self.epochMs()
            closeDevice()
            do {
                try openDevice(mic: mic) { [onDevice] in
                    onDevice?(DeviceChange(name: Self.name(uid: mic) ?? mic, lostAtMs: lost, backAtMs: Self.epochMs()))
                }
            } catch {
                // shortcut: no retry; the core sees silent levels (`MicrophoneOff`) until the
                // next device change rebuilds the device. Add a retry if the runbook shows one.
                FileHandle.standardError.write(Data("noter-engine: device change: \(error)\n".utf8))
            }
        }
    }
    // @cpt-end:cpt-noter-flow-core-engine-capture-session:p1:inst-open-streams

    private static func epochMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

    private static func address(
        _ selector: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal
    ) -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress(mSelector: selector, mScope: scope, mElement: kAudioObjectPropertyElementMain)
    }

    /// The chosen microphone while it is there, else the default input.
    static func wantedMic(_ preferred: String?) throws -> String {
        if let preferred, device(uid: preferred) != nil { return preferred }
        var address = address(kAudioHardwarePropertyDefaultInputDevice)
        var input = AudioObjectID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &input) == noErr,
            let uid = string(input, kAudioDevicePropertyDeviceUID)
        else { throw Failure(description: "no microphone") }
        return uid
    }

    static func device(uid: String) -> AudioObjectID? {
        var address = address(kAudioHardwarePropertyTranslateUIDToDevice)
        var qualifier = uid as CFString
        var device = AudioObjectID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        let status = withUnsafeMutablePointer(to: &qualifier) {
            AudioObjectGetPropertyData(
                AudioObjectID(kAudioObjectSystemObject), &address, UInt32(MemoryLayout<CFString>.size), $0, &size, &device)
        }
        return status == noErr && device != kAudioObjectUnknown ? device : nil
    }

    static func name(uid: String) -> String? { device(uid: uid).flatMap { string($0, kAudioObjectPropertyName) } }

    /// A string property of an audio object (names, UIDs, bundle ids).
    static func string(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> String? {
        var address = address(selector)
        var value: CFString = "" as CFString
        var size = UInt32(MemoryLayout<CFString>.size)
        let status = withUnsafeMutablePointer(to: &value) { AudioObjectGetPropertyData(object, &address, 0, nil, &size, $0) }
        return status == noErr ? value as String : nil
    }

    /// How many input buffers a device's IO cycle has: the microphone's come first in the aggregate.
    static func inputBuffers(_ device: AudioObjectID) -> Int {
        var address = address(kAudioDevicePropertyStreamConfiguration, kAudioObjectPropertyScopeInput)
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(device, &address, 0, nil, &size) == noErr, size > 0 else { return 1 }
        let list = UnsafeMutableRawPointer.allocate(byteCount: Int(size), alignment: MemoryLayout<AudioBufferList>.alignment)
        defer { list.deallocate() }
        guard AudioObjectGetPropertyData(device, &address, 0, nil, &size, list) == noErr else { return 1 }
        return Int(list.assumingMemoryBound(to: AudioBufferList.self).pointee.mNumberBuffers)
    }

    static func sampleRate(_ device: AudioObjectID) throws -> Double {
        var address = address(kAudioDevicePropertyNominalSampleRate)
        var rate = Float64(0)
        var size = UInt32(MemoryLayout<Float64>.size)
        guard AudioObjectGetPropertyData(device, &address, 0, nil, &size, &rate) == noErr, rate > 0 else {
            throw Failure(description: "could not read the capture sample rate")
        }
        return rate
    }

    /// The name of the default output device, which the tap hears through.
    static func defaultOutputName() -> String? {
        var address = address(kAudioHardwarePropertyDefaultOutputDevice)
        var device = AudioObjectID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &device) == noErr
        else { return nil }
        return string(device, kAudioObjectPropertyName)
    }

    /// Every process Core Audio knows, as audio objects.
    static func processObjects() -> [AudioObjectID] {
        var address = address(kAudioHardwarePropertyProcessObjectList)
        var size: UInt32 = 0
        let system = AudioObjectID(kAudioObjectSystemObject)
        guard AudioObjectGetPropertyDataSize(system, &address, 0, nil, &size) == noErr else { return [] }
        var objects = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
        guard AudioObjectGetPropertyData(system, &address, 0, nil, &size, &objects) == noErr else { return [] }
        return objects
    }

    /// The Core Audio object of a process, to leave it out of the tap.
    static func processObject(_ pid: pid_t) -> AudioObjectID? {
        var address = address(kAudioHardwarePropertyTranslatePIDToProcessObject)
        var pid = pid
        var object = AudioObjectID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        let status = AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject), &address, UInt32(MemoryLayout<pid_t>.size), &pid, &size, &object)
        return status == noErr && object != kAudioObjectUnknown ? object : nil
    }
}
