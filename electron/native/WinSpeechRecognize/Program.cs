// Program.cs
//
// Windows-native file transcription helper for ClawX.
//
// Usage:
//   WinSpeechRecognize.exe <wav-path> [locale]
//
// The Electron renderer records a PCM WAV clip, then the main process invokes
// this helper. We use System.Speech rather than WinRT SpeechRecognizer because
// the desktop engine supports SetInputToWaveFile; the WinRT one-shot API only
// records from the default microphone in this target SDK.

using System;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Speech.Recognition;
using System.Text;

namespace ClawX.WinSpeechRecognize
{
    internal static class Program
    {
        // Exit codes - keep in sync with asr-native-windows.ts.
        private const int ExitOk = 0;
        private const int ExitGenericFailure = 1;
        private const int ExitPermissionDenied = 2;
        private const int ExitAudioNotFound = 3;

        private static readonly TimeSpan RecognizerTimeout = TimeSpan.FromSeconds(28);

        [STAThread]
        private static int Main(string[] args)
        {
            Console.OutputEncoding = Encoding.UTF8;

            if (args.Length < 1 || string.IsNullOrWhiteSpace(args[0]))
            {
                Console.Error.WriteLine("Usage: WinSpeechRecognize.exe <wav-path> [locale]");
                return ExitGenericFailure;
            }

            var audioPath = args[0];
            var locale = args.Length >= 2 && !string.IsNullOrWhiteSpace(args[1])
                ? args[1].Trim()
                : "en-US";

            if (!File.Exists(audioPath))
            {
                Console.Error.WriteLine("Audio file not found: " + audioPath);
                return ExitAudioNotFound;
            }

            try
            {
                var result = Recognize(audioPath, locale);
                Console.Out.WriteLine(
                    "{\"text\":\"" + JsonEscape(result.Text) + "\",\"language\":\"" + JsonEscape(result.Language) + "\"}");
                return ExitOk;
            }
            catch (UnauthorizedAccessException ex)
            {
                Console.Error.WriteLine("Speech-recognition permission denied: " + ex.Message);
                return ExitPermissionDenied;
            }
            catch (FileNotFoundException ex)
            {
                Console.Error.WriteLine(ex.Message);
                return ExitAudioNotFound;
            }
            catch (TimeoutException ex)
            {
                Console.Error.WriteLine("Recognition timed out: " + ex.Message);
                return ExitGenericFailure;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("Recognition failed: " + ex.Message);
                return ExitGenericFailure;
            }
        }

        private static WindowsAsrResult Recognize(string audioPath, string locale)
        {
            var fullPath = Path.GetFullPath(audioPath);
            if (!File.Exists(fullPath))
            {
                throw new FileNotFoundException("Could not open audio file: " + fullPath, fullPath);
            }

            string language;
            using (var recognizer = CreateRecognizer(locale, out language))
            {
                recognizer.LoadGrammar(new DictationGrammar());
                recognizer.SetInputToWaveFile(fullPath);

                var result = recognizer.Recognize(RecognizerTimeout);
                if (result == null)
                {
                    return new WindowsAsrResult(string.Empty, language);
                }

                return new WindowsAsrResult((result.Text ?? string.Empty).Trim(), language);
            }
        }

        private static SpeechRecognitionEngine CreateRecognizer(string locale, out string language)
        {
            var requestedCulture = TryGetCulture(locale);
            var installed = SpeechRecognitionEngine.InstalledRecognizers();
            var recognizer = installed.FirstOrDefault((info) =>
                requestedCulture != null &&
                string.Equals(info.Culture.Name, requestedCulture.Name, StringComparison.OrdinalIgnoreCase));

            if (recognizer == null && requestedCulture != null)
            {
                recognizer = installed.FirstOrDefault((info) =>
                    string.Equals(info.Culture.TwoLetterISOLanguageName, requestedCulture.TwoLetterISOLanguageName, StringComparison.OrdinalIgnoreCase));
            }

            if (recognizer == null)
            {
                recognizer = installed.FirstOrDefault();
            }

            if (recognizer == null)
            {
                throw new InvalidOperationException("No Windows desktop speech recognizer is installed.");
            }

            language = recognizer.Culture.Name;
            return new SpeechRecognitionEngine(recognizer);
        }

        private static CultureInfo? TryGetCulture(string locale)
        {
            try
            {
                return CultureInfo.GetCultureInfo(locale);
            }
            catch (CultureNotFoundException)
            {
                return null;
            }
        }

        private static string JsonEscape(string value)
        {
            var sb = new StringBuilder(value.Length + 16);
            foreach (var ch in value)
            {
                switch (ch)
                {
                    case '"':
                        sb.Append("\\\"");
                        break;
                    case '\\':
                        sb.Append("\\\\");
                        break;
                    case '\b':
                        sb.Append("\\b");
                        break;
                    case '\f':
                        sb.Append("\\f");
                        break;
                    case '\n':
                        sb.Append("\\n");
                        break;
                    case '\r':
                        sb.Append("\\r");
                        break;
                    case '\t':
                        sb.Append("\\t");
                        break;
                    default:
                        if (ch < 32)
                        {
                            sb.Append("\\u");
                            sb.Append(((int)ch).ToString("x4", CultureInfo.InvariantCulture));
                        }
                        else
                        {
                            sb.Append(ch);
                        }
                        break;
                }
            }
            return sb.ToString();
        }

        private sealed class WindowsAsrResult
        {
            public WindowsAsrResult(string text, string language)
            {
                Text = text;
                Language = language;
            }

            public string Text { get; private set; }

            public string Language { get; private set; }
        }
    }
}
