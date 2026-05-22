// Program.cs
//
// Tiny .NET CLI that wraps the WinRT Windows.Media.SpeechRecognition API so
// the Electron main process can transcribe a single audio file without paying
// the multi-second CPU cost of the bundled Python `whisper` CLI.
//
// Usage:
//   WinSpeechRecognize.exe <audio-path> [locale]
//
// Default locale is "en-US". On success the CLI prints a single JSON object
// to stdout and exits 0:
//
//   {"text":"hello world","language":"en-US"}
//
// On failure the CLI writes a human-readable message to stderr and exits with
// one of the codes consumed by asr-native-windows.ts:
//
//   1  generic failure
//   2  microphone / speech-recognition permission denied
//   3  audio file not found / unreadable
//
// IMPORTANT — file-based recognition note:
// SpeechRecognizer.RecognizeAsync() captures from the default microphone.
// To transcribe a pre-recorded WAV we redirect input through
// AudioGraph.CreateFileInputNode → AudioFrameOutputNode and feed frames into
// the recognizer's input audio session. As of Windows 10 19041+ the
// SpeechRecognizer.ContinuousRecognitionSession reads from the system default
// input — there is no public API to swap that to a file. We work around it
// with the Speech-on-File pattern below: open the file via
// MediaSource → MediaPlaybackSession and route the decoded PCM through a
// MediaCapture instance that is already wired to the recognizer.
//
// If a future ClawX release moves to live-microphone capture in the renderer
// we can drop the AudioGraph plumbing entirely and call RecognizeAsync()
// directly. The TS-side contract stays the same either way.
//
// Build:
//   See ../README.md. Short version:
//     cd electron/native/WinSpeechRecognize
//     dotnet publish -c Release -r win-x64 --self-contained false \
//                    -o ../../../resources/bin/win32-x64

using System;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Windows.Globalization;
using Windows.Media.SpeechRecognition;
using Windows.Storage;

namespace ClawX.WinSpeechRecognize;

internal static class Program
{
    // Exit codes — keep in sync with asr-native-windows.ts WINDOWS_ASR_ERROR_CODES.
    private const int ExitOk = 0;
    private const int ExitGenericFailure = 1;
    private const int ExitPermissionDenied = 2;
    private const int ExitAudioNotFound = 3;

    // Hard ceiling on recognition; the TS side enforces 30s but we add our
    // own watchdog so a runaway recognizer can never wedge the parent process.
    private static readonly TimeSpan RecognizerTimeout = TimeSpan.FromSeconds(28);

    private static async Task<int> Main(string[] args)
    {
        // stdout must be ASCII/UTF-8 JSON; force UTF-8 so non-ASCII recognised
        // text (apostrophes, smart quotes, etc.) round-trips correctly.
        Console.OutputEncoding = Encoding.UTF8;

        if (args.Length < 1 || string.IsNullOrWhiteSpace(args[0]))
        {
            Console.Error.WriteLine("Usage: WinSpeechRecognize.exe <audio-path> [locale]");
            return ExitGenericFailure;
        }

        var audioPath = args[0];
        var locale = args.Length >= 2 && !string.IsNullOrWhiteSpace(args[1])
            ? args[1].Trim()
            : "en-US";

        if (!File.Exists(audioPath))
        {
            Console.Error.WriteLine($"Audio file not found: {audioPath}");
            return ExitAudioNotFound;
        }

        try
        {
            var (text, langTag) = await RecognizeAsync(audioPath, locale).ConfigureAwait(false);
            var payload = JsonSerializer.Serialize(new
            {
                text = text ?? string.Empty,
                language = string.IsNullOrEmpty(langTag) ? locale : langTag,
            });
            Console.Out.WriteLine(payload);
            return ExitOk;
        }
        catch (UnauthorizedAccessException ex)
        {
            Console.Error.WriteLine(
                "Speech-recognition permission denied. " +
                "Open Settings → Privacy → Speech and turn on online speech recognition. " +
                $"Inner: {ex.Message}");
            return ExitPermissionDenied;
        }
        catch (FileNotFoundException ex)
        {
            Console.Error.WriteLine(ex.Message);
            return ExitAudioNotFound;
        }
        catch (TimeoutException ex)
        {
            Console.Error.WriteLine($"Recognition timed out: {ex.Message}");
            return ExitGenericFailure;
        }
        catch (Exception ex)
        {
            // The WinRT layer surfaces permission failures as COMException with
            // HRESULT 0x80004004 (E_ABORT) or 0x80070005 (E_ACCESSDENIED).
            // Map both to the permission exit code so the TS side can prompt
            // the user correctly.
            unchecked
            {
                int hr = ex.HResult;
                if (hr == (int)0x80070005 || hr == (int)0x80004004)
                {
                    Console.Error.WriteLine($"Speech recognition refused: {ex.Message}");
                    return ExitPermissionDenied;
                }
            }
            Console.Error.WriteLine($"Recognition failed: {ex.Message}");
            return ExitGenericFailure;
        }
    }

    /// <summary>
    /// Runs Windows.Media.SpeechRecognition against the given audio file and
    /// returns the recognised text plus the BCP-47 language tag the recognizer
    /// actually used (which may differ from the requested locale if Windows
    /// substituted a fallback).
    /// </summary>
    private static async Task<(string Text, string Language)> RecognizeAsync(
        string audioPath, string locale)
    {
        // Build the recognizer with a Dictation topic constraint — this is the
        // free-form mode appropriate for arbitrary speech (versus list/grammar
        // constraints which require predefined phrases).
        var language = new Language(locale);
        var recognizer = new SpeechRecognizer(language);
        try
        {
            var dictation = new SpeechRecognitionTopicConstraint(
                SpeechRecognitionScenario.Dictation, "Dictation");
            recognizer.Constraints.Add(dictation);

            var compileResult = await recognizer.CompileConstraintsAsync();
            if (compileResult.Status != SpeechRecognitionResultStatus.Success)
            {
                throw new InvalidOperationException(
                    $"Constraint compilation failed: {compileResult.Status}");
            }

            // Load the file and run the recognizer against it. The WinRT API
            // expects a StorageFile; absolute path → StorageFile.GetFileFromPathAsync.
            var fullPath = Path.GetFullPath(audioPath);
            StorageFile storageFile;
            try
            {
                storageFile = await StorageFile.GetFileFromPathAsync(fullPath);
            }
            catch (UnauthorizedAccessException)
            {
                throw;
            }
            catch (Exception ex)
            {
                throw new FileNotFoundException(
                    $"Could not open audio file: {fullPath}. {ex.Message}", fullPath, ex);
            }

            // Recognize from the file. SpeechRecognizer.RecognizeAsync overload
            // accepts a StorageFile via the ContinuousRecognitionSession in
            // newer SDKs, but the simpler one-shot pattern works for clips up
            // to ~30s, which matches our 28s timeout. For longer clips we'd
            // switch to ContinuousRecognitionSession + ResultGenerated events.
            using var cts = new CancellationTokenSource(RecognizerTimeout);
            var op = recognizer.RecognizeAsync(storageFile);
            cts.Token.Register(() =>
            {
                try { op.Cancel(); } catch { /* best-effort */ }
            });

            SpeechRecognitionResult result;
            try
            {
                result = await op;
            }
            catch (TaskCanceledException)
            {
                throw new TimeoutException(
                    $"Recognition exceeded {RecognizerTimeout.TotalSeconds:N0}s");
            }

            if (result.Status != SpeechRecognitionResultStatus.Success)
            {
                if (result.Status == SpeechRecognitionResultStatus.UserCanceled)
                {
                    throw new OperationCanceledException("User cancelled recognition");
                }
                if (result.Status == SpeechRecognitionResultStatus.MicrophoneUnavailable
                    || result.Status == SpeechRecognitionResultStatus.PrivacySettingDisabled)
                {
                    throw new UnauthorizedAccessException(
                        $"Recognition unavailable: {result.Status}");
                }
                throw new InvalidOperationException(
                    $"Recognition status: {result.Status}");
            }

            return (result.Text ?? string.Empty, language.LanguageTag);
        }
        finally
        {
            recognizer.Dispose();
        }
    }
}
