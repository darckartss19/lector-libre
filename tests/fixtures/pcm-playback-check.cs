using System;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;

public static class PcmPlaybackCheck
{
    public static string Run()
    {
        long maximum = 0;
        // Real default audio device, but only zero-valued samples: no audible test speech.
        for (int index = 0; index < 5; index++)
        {
            using (var first = new ReaderPcmPlayback(new byte[22050 * 2 * 10], 22050))
            {
                var waiting = Task.Factory.StartNew(() => first.Wait());
                Thread.Sleep(60);
                if (!first.IsPlaying) throw new Exception("Long buffer completed before cancellation.");
                var clock = Stopwatch.StartNew();
                first.Stop();
                if (first.IsPlaying || !waiting.Wait(500)) throw new Exception("Cancellation waited for the audio fragment.");
                maximum = Math.Max(maximum, clock.ElapsedMilliseconds);
                using (var next = new ReaderPcmPlayback(new byte[22050 * 2], 22050))
                {
                    // Cleaning up an old request must not cancel the new device.
                    first.Dispose();
                    if (!next.IsPlaying) throw new Exception("Old playback disposal stopped the new fragment.");
                    next.Stop();
                    next.Wait();
                }
            }
        }
        var natural = Stopwatch.StartNew();
        using (var shortAudio = new ReaderPcmPlayback(new byte[22050 * 2 / 5], 22050))
        {
            shortAudio.Wait();
            if (shortAudio.IsPlaying) throw new Exception("Device completion was not observed.");
        }
        if (natural.ElapsedMilliseconds < 100 || natural.ElapsedMilliseconds > 2500)
            throw new Exception("Natural completion did not follow the audio device.");
        return "{\"iterations\":5,\"maxCancelMs\":" + maximum + ",\"naturalMs\":" + natural.ElapsedMilliseconds + ",\"silentSamples\":true}";
    }
}
