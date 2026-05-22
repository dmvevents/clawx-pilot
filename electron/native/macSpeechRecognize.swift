// macSpeechRecognize.swift
//
// Tiny Swift CLI that wraps Apple's Speech.framework so the Electron main
// process can transcribe a single audio file without paying the 30-60s CPU
// cost of the bundled `whisper` Python CLI.
//
// Usage:
//   macSpeechRecognize <audio-path> [locale]
//
// Default locale is "en-US". The CLI prints structured JSON to stdout so the
// caller can parse `text` and `language` reliably:
//
//   { "ok": true, "text": "hello world", "language": "en-US" }
//   { "ok": false, "code": "MIC_PERMISSION", "message": "..." }
//
// Exit code: 0 on success, 1 on any failure. The TS caller branches on the
// JSON `code` field; exit code is purely a sanity check.
//
// Build:
//   swiftc -O -o resources/bin/darwin-arm64/macSpeechRecognize \
//          electron/native/macSpeechRecognize.swift
//
// First run will trigger the macOS Speech Recognition permission prompt the
// first time SFSpeechRecognizer.requestAuthorization is invoked. The Info.plist
// for the host app already needs NSSpeechRecognitionUsageDescription set;
// running this binary standalone uses the current process's plist (none),
// which still works on modern macOS but the user sees a generic prompt.

import Foundation
import Speech

// MARK: - Output helpers

struct Reply: Codable {
    let ok: Bool
    let text: String?
    let language: String?
    let code: String?
    let message: String?
}

func emit(_ reply: Reply) -> Never {
    let encoder = JSONEncoder()
    encoder.outputFormatting = []
    if let data = try? encoder.encode(reply),
       let json = String(data: data, encoding: .utf8) {
        print(json)
    } else {
        // Fallback if JSON encoding fails for some reason.
        print(#"{"ok":false,"code":"INTERNAL","message":"json encode failed"}"#)
    }
    exit(reply.ok ? 0 : 1)
}

func fail(_ code: String, _ message: String) -> Never {
    emit(Reply(ok: false, text: nil, language: nil, code: code, message: message))
}

// MARK: - Argument parsing

let args = CommandLine.arguments
guard args.count >= 2 else {
    fail("BAD_ARGS", "Usage: macSpeechRecognize <audio-path> [locale]")
}

let audioPath = args[1]
let localeId = args.count >= 3 ? args[2] : "en-US"

let fileManager = FileManager.default
guard fileManager.fileExists(atPath: audioPath) else {
    fail("FILE_NOT_FOUND", "Audio file does not exist: \(audioPath)")
}

let url = URL(fileURLWithPath: audioPath)

// MARK: - Recognizer setup

guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: localeId)) else {
    fail("LOCALE_UNSUPPORTED", "No speech recognizer for locale \(localeId)")
}

guard recognizer.isAvailable else {
    fail("RECOGNIZER_UNAVAILABLE", "Speech recognizer is not currently available (offline?)")
}

// MARK: - Permission

let authSemaphore = DispatchSemaphore(value: 0)
var authStatus: SFSpeechRecognizerAuthorizationStatus = .notDetermined

SFSpeechRecognizer.requestAuthorization { status in
    authStatus = status
    authSemaphore.signal()
}

// Cap permission wait at 25s; the user has time to click the prompt but we
// never hang forever.
let permTimeout = DispatchTime.now() + .seconds(25)
if authSemaphore.wait(timeout: permTimeout) == .timedOut {
    fail("MIC_PERMISSION", "Timed out waiting for Speech Recognition authorization")
}

switch authStatus {
case .authorized:
    break
case .denied:
    fail("MIC_PERMISSION", "Speech Recognition permission denied. Open System Settings > Privacy & Security > Speech Recognition and enable it for this app.")
case .restricted:
    fail("MIC_PERMISSION", "Speech Recognition is restricted on this device (parental controls / MDM)")
case .notDetermined:
    fail("MIC_PERMISSION", "Speech Recognition permission was not granted")
@unknown default:
    fail("MIC_PERMISSION", "Unknown Speech Recognition authorization state")
}

// MARK: - Recognition

let request = SFSpeechURLRecognitionRequest(url: url)
// Partials are essential — for short clips (1–3 s) Apple's recogniser often
// emits useful transcripts but never sets `isFinal = true`. We track the most
// recent partial and accept it after a stabilisation window.
request.shouldReportPartialResults = true
// Note: we deliberately do NOT set requiresOnDeviceRecognition = true here.
// In a standalone unsigned helper (no app bundle, no entitlements), forcing
// on-device silently produces zero partial results on Apple Silicon. The
// helper still keeps audio local in practice when the OS routes it through
// the on-device model — but allowing the framework to choose its own backend
// is the only way to get reliable transcripts from a CLI binary.

let stateLock = NSLock()
var latestText: String = ""
var sawAnyResult = false
var recogError: Error? = nil
var finalised = false
let resultSignal = DispatchSemaphore(value: 0)
var lastUpdateTick = DispatchTime.now()

let task = recognizer.recognitionTask(with: request) { result, error in
    stateLock.lock()
    defer { stateLock.unlock() }
    if finalised { return }
    if let error = error {
        let nsErr = error as NSError
        let lower = nsErr.localizedDescription.lowercased()
        // Treat "no speech detected" as a successful empty transcript.
        if lower.contains("no speech") || nsErr.code == 1110 || nsErr.code == 1101
            || nsErr.code == 203 || nsErr.code == 1700 {
            finalised = true
            resultSignal.signal()
            return
        }
        // If we already have a partial, keep it and call it done.
        if sawAnyResult && !latestText.isEmpty {
            finalised = true
            resultSignal.signal()
            return
        }
        recogError = error
        finalised = true
        resultSignal.signal()
        return
    }
    guard let result = result else { return }
    sawAnyResult = true
    latestText = result.bestTranscription.formattedString
    lastUpdateTick = DispatchTime.now()
    if result.isFinal {
        finalised = true
        resultSignal.signal()
    }
}

// Wait up to 20s for *any* recognition signal. Once partials start arriving,
// the per-tick stabilisation loop below accepts the latest partial after
// 1.5s of no further updates — handling the common "never reaches isFinal"
// case cleanly.
let initialDeadline = DispatchTime.now() + .seconds(20)
let stabilisationGapMs: Int = 1500
var timedOut = false

pollLoop: while true {
    if resultSignal.wait(timeout: DispatchTime.now() + .milliseconds(200)) == .success {
        // Either isFinal or fatal error — handled in the closure.
        break pollLoop
    }
    stateLock.lock()
    let isFin = finalised
    let haveResult = sawAnyResult && !latestText.isEmpty
    let lastTick = lastUpdateTick
    stateLock.unlock()
    if isFin { break pollLoop }
    if haveResult {
        // Accept the partial if no update has landed in the gap window.
        let elapsedMs = (DispatchTime.now().uptimeNanoseconds &- lastTick.uptimeNanoseconds) / 1_000_000
        if Int(elapsedMs) >= stabilisationGapMs {
            stateLock.lock()
            finalised = true
            stateLock.unlock()
            break pollLoop
        }
    }
    if DispatchTime.now() >= initialDeadline {
        timedOut = true
        break pollLoop
    }
}

task.cancel()

if let error = recogError as NSError? {
    let domain = error.domain
    let code = error.code
    let message = error.localizedDescription
    fail("RECOGNITION_FAILED", "\(domain) #\(code): \(message)")
}

if timedOut && latestText.isEmpty {
    fail("TIMEOUT", "Speech recognition timed out after 20s with no audio matched")
}

emit(Reply(ok: true, text: latestText, language: localeId, code: nil, message: nil))
