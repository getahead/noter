// The live channels: the microphone through AVAudioEngine and system audio through a Core
// Audio process tap (macOS 14.2+) that leaves out this engine and the app that started it.
// shortcut: not exercised by the CI tests (they need the TCC prompts); the week-one spike
// (`.plans/engine-spike-runbook.md`) runs it on a Mac and records what it delivers.

import AVFoundation
import CoreAudio
import Foundation

public final class LiveAudioSource: AudioSource, @unchecked Sendable {
    public struct Failure: Error, CustomStringConvertible {
        public let description: String
    }

    private let lock = NSLock()
    private var mic: AVAudioEngine?
    private var tap = AudioObjectID(kAudioObjectUnknown)
    private var device = AudioObjectID(kAudioObjectUnknown)
    private var proc: AudioDeviceIOProcID?

    public init() {}

    public func start(_ onChunk: @escaping @Sendable (AudioChunk) -> Void) throws {
        do {
            try startSystemAudio(onChunk)
            try startMicrophone(onChunk)
        } catch {
            stop()
            throw error
        }
    }

    public func stop() {
        lock.lock()
        defer { lock.unlock() }
        mic?.inputNode.removeTap(onBus: 0)
        mic?.stop()
        mic = nil
        if device != kAudioObjectUnknown {
            if let proc {
                AudioDeviceStop(device, proc)
                AudioDeviceDestroyIOProcID(device, proc)
            }
            AudioHardwareDestroyAggregateDevice(device)
        }
        if tap != kAudioObjectUnknown { AudioHardwareDestroyProcessTap(tap) }
        (tap, device, proc) = (AudioObjectID(kAudioObjectUnknown), AudioObjectID(kAudioObjectUnknown), nil)
    }

    private func check(_ status: OSStatus, _ what: String) throws {
        if status != noErr { throw Failure(description: "could not \(what) (OSStatus \(status))") }
    }

    private func startSystemAudio(_ onChunk: @escaping @Sendable (AudioChunk) -> Void) throws {
        let excluded = [getpid(), getppid()].compactMap(LiveAudioSource.processObject)
        let description = CATapDescription(stereoGlobalTapButExcludeProcesses: excluded)
        description.uuid = UUID()
        description.isPrivate = true
        description.muteBehavior = .unmuted
        var tap = AudioObjectID(kAudioObjectUnknown)
        try check(AudioHardwareCreateProcessTap(description, &tap), "create the system audio tap")
        lock.withLock { self.tap = tap }

        let aggregate: [String: Any] = [
            kAudioAggregateDeviceNameKey: "Noter system audio",
            kAudioAggregateDeviceUIDKey: UUID().uuidString,
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceTapAutoStartKey: true,
            kAudioAggregateDeviceTapListKey: [[kAudioSubTapUIDKey: description.uuid.uuidString]],
        ]
        var device = AudioObjectID(kAudioObjectUnknown)
        try check(AudioHardwareCreateAggregateDevice(aggregate as CFDictionary, &device), "create the tap device")
        lock.withLock { self.device = device }
        let format = try tapFormat(tap)

        var proc: AudioDeviceIOProcID?
        try check(
            AudioDeviceCreateIOProcIDWithBlock(&proc, device, nil) { _, input, _, _, _ in
                // The tap delivers interleaved float frames in one buffer.
                let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: input))
                guard let first = buffers.first, let raw = first.mData else { return }
                let count = Int(first.mDataByteSize) / MemoryLayout<Float>.size
                let interleaved = Array(UnsafeBufferPointer(start: raw.assumingMemoryBound(to: Float.self), count: count))
                let samples = Mix.mono(interleaved, channels: Int(format.mChannelsPerFrame))
                onChunk(AudioChunk(channel: .sys, samples: samples, sampleRate: format.mSampleRate))
            }, "install the tap callback")
        lock.withLock { self.proc = proc }
        try check(AudioDeviceStart(device, proc), "start the tap")
    }

    private func startMicrophone(_ onChunk: @escaping @Sendable (AudioChunk) -> Void) throws {
        let engine = AVAudioEngine()
        let input = engine.inputNode
        input.installTap(onBus: 0, bufferSize: 4096, format: input.outputFormat(forBus: 0)) { buffer, _ in
            guard let data = buffer.floatChannelData else { return }
            let samples = Array(UnsafeBufferPointer(start: data[0], count: Int(buffer.frameLength)))
            onChunk(AudioChunk(channel: .mic, samples: samples, sampleRate: buffer.format.sampleRate))
        }
        lock.withLock { self.mic = engine }
        try engine.start()
    }

    public var devices: (mic: String, output: String) {
        (AVCaptureDevice.default(for: .audio)?.localizedName ?? "", Self.defaultOutputName() ?? "")
    }

    /// The name of the default output device, which the tap hears through.
    static func defaultOutputName() -> String? {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultOutputDevice, mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        var device = AudioObjectID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &device) == noErr
        else { return nil }
        address.mSelector = kAudioObjectPropertyName
        var name: CFString = "" as CFString
        size = UInt32(MemoryLayout<CFString>.size)
        let status = withUnsafeMutablePointer(to: &name) { AudioObjectGetPropertyData(device, &address, 0, nil, &size, $0) }
        return status == noErr ? name as String : nil
    }

    /// The tap's stream format (sample rate and channels per frame).
    private func tapFormat(_ tap: AudioObjectID) throws -> AudioStreamBasicDescription {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioTapPropertyFormat,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        var format = AudioStreamBasicDescription()
        var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        try check(AudioObjectGetPropertyData(tap, &address, 0, nil, &size, &format), "read the tap format")
        return format
    }

    /// The Core Audio object of a process, to leave it out of the tap.
    static func processObject(_ pid: pid_t) -> AudioObjectID? {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyTranslatePIDToProcessObject,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        var pid = pid
        var object = AudioObjectID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        let status = AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject), &address, UInt32(MemoryLayout<pid_t>.size), &pid, &size, &object)
        return status == noErr && object != kAudioObjectUnknown ? object : nil
    }
}
