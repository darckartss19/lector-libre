using System;
using System.Runtime.InteropServices;
using System.Threading;

// Own one Windows waveform device per fragment. Buffers remain pinned until
// the driver returns them; stopping this device cannot stop a newer fragment.
public sealed class ReaderPcmPlayback : IDisposable
{
    private const uint WaveMapper = 0xffffffff;
    private const uint CallbackEvent = 0x00050000;
    private const uint HeaderDone = 1;
    private readonly object gate = new object();
    private readonly AutoResetEvent changed;
    private readonly uint headerSize = (uint)Marshal.SizeOf(typeof(WaveHeader));
    private IntPtr device;
    private IntPtr header;
    private GCHandle audio;
    private bool prepared;
    private bool stopped;
    private bool disposed;

    [StructLayout(LayoutKind.Sequential, Pack = 2)]
    private struct WaveFormat
    {
        public ushort format, channels;
        public uint sampleRate, bytesPerSecond;
        public ushort blockAlign, bitsPerSample, extraBytes;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct WaveHeader
    {
        public IntPtr data;
        public uint length, recorded;
        public UIntPtr user;
        public uint flags, loops;
        public IntPtr next;
        public UIntPtr reserved;
    }

    [DllImport("winmm.dll")]
    private static extern uint waveOutOpen(out IntPtr device, uint id,
        ref WaveFormat format, IntPtr callback, UIntPtr instance, uint flags);
    [DllImport("winmm.dll")]
    private static extern uint waveOutPrepareHeader(IntPtr device, IntPtr header, uint size);
    [DllImport("winmm.dll")]
    private static extern uint waveOutWrite(IntPtr device, IntPtr header, uint size);
    [DllImport("winmm.dll")]
    private static extern uint waveOutReset(IntPtr device);
    [DllImport("winmm.dll")]
    private static extern uint waveOutUnprepareHeader(IntPtr device, IntPtr header, uint size);
    [DllImport("winmm.dll")]
    private static extern uint waveOutClose(IntPtr device);

    private static void Check(uint code)
    {
        if (code != 0) throw new InvalidOperationException("No se pudo controlar el dispositivo de audio (" + code + ").");
    }

    public ReaderPcmPlayback(byte[] pcm, int sampleRate)
    {
        if (pcm == null || pcm.Length == 0 || pcm.Length % 2 != 0 || sampleRate < 8000 || sampleRate > 192000)
            throw new ArgumentException("Audio PCM no válido.");
        changed = new AutoResetEvent(false);
        try
        {
            var format = new WaveFormat { format = 1, channels = 1,
                sampleRate = (uint)sampleRate, bytesPerSecond = (uint)sampleRate * 2,
                blockAlign = 2, bitsPerSample = 16, extraBytes = 0 };
            Check(waveOutOpen(out device, WaveMapper, ref format,
                changed.SafeWaitHandle.DangerousGetHandle(), UIntPtr.Zero, CallbackEvent));
            audio = GCHandle.Alloc(pcm, GCHandleType.Pinned);
            header = Marshal.AllocHGlobal((int)headerSize);
            Marshal.StructureToPtr(new WaveHeader { data = audio.AddrOfPinnedObject(), length = (uint)pcm.Length }, header, false);
            Check(waveOutPrepareHeader(device, header, headerSize));
            prepared = true;
            changed.Reset();
            Check(waveOutWrite(device, header, headerSize));
        }
        catch { Dispose(); throw; }
    }

    public bool IsPlaying
    {
        get
        {
            lock (gate)
            {
                if (disposed || stopped || header == IntPtr.Zero) return false;
                var value = (WaveHeader)Marshal.PtrToStructure(header, typeof(WaveHeader));
                return (value.flags & HeaderDone) == 0;
            }
        }
    }

    public void Wait()
    {
        while (IsPlaying) changed.WaitOne(50);
    }

    public void Stop()
    {
        lock (gate)
        {
            if (disposed || stopped) return;
            if (device != IntPtr.Zero) Check(waveOutReset(device));
            stopped = true;
            changed.Set();
        }
    }

    public void Dispose()
    {
        lock (gate)
        {
            if (disposed) return;
            Stop();
            if (prepared) { Check(waveOutUnprepareHeader(device, header, headerSize)); prepared = false; }
            if (device != IntPtr.Zero) { Check(waveOutClose(device)); device = IntPtr.Zero; }
            if (header != IntPtr.Zero) { Marshal.FreeHGlobal(header); header = IntPtr.Zero; }
            if (audio.IsAllocated) audio.Free();
            disposed = true;
            changed.Dispose();
        }
    }
}
