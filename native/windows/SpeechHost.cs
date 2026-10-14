using System;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Speech.Synthesis;
using System.Text;
using System.Web.Script.Serialization;
using System.IO;
using System.Diagnostics;
using System.Threading;
using System.Globalization;

// Experimental Windows adapter. The engine runs outside the reader UI;
// minimizing a window does not suspend its worker. No WAV/MP3 files are made.
public static class ReaderSpeechHost
{
    private static readonly object OutputLock = new object();
    private static readonly ConcurrentDictionary<Prompt, string> Ids = new ConcurrentDictionary<Prompt, string>();

    private static void Send(object message)
    {
        lock (OutputLock) { Console.WriteLine(new JavaScriptSerializer().Serialize(message)); Console.Out.Flush(); }
    }

    public static void Run(bool silent)
    {
        Console.InputEncoding = new UTF8Encoding(false);
        Console.OutputEncoding = new UTF8Encoding(false);
        using (var neural = new ReaderNeuralSpeech(silent, Send))
        using (var engine = new SpeechSynthesizer())
        {
            if (silent) engine.SetOutputToNull();
            else engine.SetOutputToDefaultAudioDevice();
            engine.SpeakStarted += delegate(object sender, SpeakStartedEventArgs args) {
                string id; if (Ids.TryGetValue(args.Prompt, out id)) Send(new { type = "started", id = id });
            };
            engine.SpeakProgress += delegate(object sender, SpeakProgressEventArgs args) {
                string id; if (Ids.TryGetValue(args.Prompt, out id)) Send(new { type = "progress", id = id, offset = args.CharacterPosition, length = args.CharacterCount });
            };
            engine.SpeakCompleted += delegate(object sender, SpeakCompletedEventArgs args) {
                string id; if (Ids.TryRemove(args.Prompt, out id)) Send(new { type = "completed", id = id, cancelled = args.Cancelled, error = args.Error == null ? null : args.Error.Message });
            };
            Send(new { type = "ready", protocol = 1, silent = silent });
            string line;
            while ((line = Console.ReadLine()) != null)
            {
                string requestId = null;
                try
                {
                    var command = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(line);
                    requestId = (string)command["requestId"];
                    string action = (string)command["action"];
                    object result = null;
                    switch (action)
                    {
                        case "voices":
                            var voices = new List<object>();
                            foreach (var installed in engine.GetInstalledVoices())
                                if (installed.Enabled) voices.Add(new { id = installed.VoiceInfo.Name, name = installed.VoiceInfo.Name, language = installed.VoiceInfo.Culture.Name, offline = true, installed = true, engine = "windows" });
                            voices.AddRange(neural.Voices());
                            result = voices;
                            break;
                        case "speak":
                            string text = (string)command["text"];
                            string id = (string)command["id"];
                            string voice = (string)command["voice"];
                            double rate = Convert.ToDouble(command["rate"]);
                            if (String.IsNullOrWhiteSpace(text) || text.Length > 4096 || String.IsNullOrWhiteSpace(id) || Double.IsNaN(rate) || Double.IsInfinity(rate) || rate < 0.5 || rate > 3)
                                throw new ArgumentException("Texto o velocidad no válidos.");
                            neural.Cancel();
                            engine.SpeakAsyncCancelAll();
                            engine.Resume();
                            if (voice.StartsWith("piper:", StringComparison.Ordinal)) { neural.Speak(id, text, voice, rate); break; }
                            engine.SelectVoice(voice);
                            // SAPI uses an integer scale; the multiplier is approximate.
                            engine.Rate = Math.Max(-10, Math.Min(10, (int)Math.Round(Math.Log(rate, 2) * 5)));
                            var prompt = new Prompt(text, SynthesisTextFormat.Text);
                            Ids[prompt] = id;
                            engine.SpeakAsync(prompt);
                            break;
                        case "pause": engine.Pause(); break;
                        case "resume": engine.Resume(); break;
                        case "cancel": neural.Cancel(); engine.SpeakAsyncCancelAll(); break;
                        case "shutdown":
                            neural.Cancel();
                            engine.SpeakAsyncCancelAll();
                            Send(new { type = "response", requestId = requestId, ok = true });
                            return;
                        default: throw new ArgumentException("Orden no reconocida.");
                    }
                    Send(new { type = "response", requestId = requestId, ok = true, result = result });
                }
                catch (Exception error) { Send(new { type = "response", requestId = requestId, ok = false, error = error.Message }); }
            }
            engine.SpeakAsyncCancelAll();
        }
    }
}

// Each bounded request is synthesized and played entirely in memory. Models
// stay on disk; generated book audio is never saved as an audiobook or temp WAV.
public sealed class ReaderNeuralSpeech : IDisposable
{
    private readonly bool silent;
    private readonly Action<object> send;
    private readonly object gate = new object();
    private Process process;
    private ReaderPcmPlayback player;
    private int generation;
    private readonly string root;
    private readonly string catalogPath;
    public ReaderNeuralSpeech(bool silent, Action<object> send) {
        this.silent=silent; this.send=send;
        root=Environment.GetEnvironmentVariable("LECTOR_VOICES_DIR");
        catalogPath=Environment.GetEnvironmentVariable("LECTOR_VOICE_CATALOG");
    }
    private List<Dictionary<string,object>> Installed() {
        var result=new List<Dictionary<string,object>>();
        if (String.IsNullOrEmpty(root) || String.IsNullOrEmpty(catalogPath) || !File.Exists(catalogPath) || !File.Exists(Path.Combine(root,"runtime","piper","piper.exe"))) return result;
        foreach(var required in new [] {"onnxruntime.dll","piper_phonemize.dll","espeak-ng.dll"}) if(!File.Exists(Path.Combine(root,"runtime","piper",required))) return result;
        if(!Directory.Exists(Path.Combine(root,"runtime","piper","espeak-ng-data"))) return result;
        var data=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(File.ReadAllText(catalogPath,Encoding.UTF8));
        // Values deserialized into object use ArrayList on .NET Framework.
        foreach (var item in (System.Collections.IEnumerable)data["voices"]) {
            var voice=(Dictionary<string,object>)item; var key=(string)voice["key"];
            var folder=Path.Combine(root,key); var marker=Path.Combine(folder,"installed.sha256");
            var model=Path.Combine(folder,key+".onnx");
            if (File.Exists(marker) && File.ReadAllText(marker)==(string)voice["modelSha256"] && File.Exists(model) && new FileInfo(model).Length==Convert.ToInt64(voice["size"]) && File.Exists(Path.Combine(folder,key+".onnx.json"))) result.Add(voice);
        }
        return result;
    }
    public List<object> Voices() {
        var result=new List<object>();
        foreach(var v in Installed()) result.Add(new {id=v["id"],name=v["name"],language=v["language"],offline=true,installed=true,engine="piper"});
        return result;
    }
    public void Cancel() {
        Interlocked.Increment(ref generation);
        lock(gate) {
            if(player!=null) {player.Stop(); player=null;}
            if(process!=null) {try {if(!process.HasExited) process.Kill();} catch {} process=null;}
        }
    }
    private static string Quote(string value) {return "\""+value.Replace("\"","\\\"")+"\"";}
    public void Speak(string id,string text,string voice,double rate) {
        Dictionary<string,object> selected=null;
        foreach(var item in Installed()) if((string)item["id"]==voice) selected=item;
        if(selected==null) throw new ArgumentException("La voz no está descargada en este dispositivo.");
        var ticket=generation; var key=(string)selected["key"]; var sampleRate=Convert.ToInt32(selected["sampleRate"]);
        ThreadPool.QueueUserWorkItem(delegate {
            string error=null; Process worker=null; ReaderPcmPlayback sound=null;
            try {
                var info=new ProcessStartInfo(Path.Combine(root,"runtime","piper","piper.exe"));
                info.Arguments="--model "+Quote(Path.Combine(root,key,key+".onnx"))+" --output_raw --json-input --length_scale "+(1.0/rate).ToString(CultureInfo.InvariantCulture)+" --quiet";
                info.UseShellExecute=false; info.CreateNoWindow=true; info.RedirectStandardInput=true; info.RedirectStandardOutput=true; info.RedirectStandardError=true;
                info.WorkingDirectory=Path.Combine(root,"runtime","piper");
                lock(gate) {if(ticket!=generation) return; worker=Process.Start(info); process=worker;}
                worker.ErrorDataReceived+=delegate {}; worker.BeginErrorReadLine();
                var request=Encoding.UTF8.GetBytes(new JavaScriptSerializer().Serialize(new {text=text})+"\n");
                worker.StandardInput.BaseStream.Write(request,0,request.Length); worker.StandardInput.BaseStream.Flush(); worker.StandardInput.Close();
                byte[] audio;
                using(var raw=new MemoryStream()) {worker.StandardOutput.BaseStream.CopyTo(raw); audio=raw.ToArray();}
                worker.WaitForExit();
                if(ticket!=generation) return;
                if(worker.ExitCode!=0 || audio.Length<2) throw new InvalidOperationException("No se pudo preparar la voz descargada.");
                lock(gate) {
                    if(ticket!=generation) return;
                    if(!silent) {sound=new ReaderPcmPlayback(audio,sampleRate); player=sound;}
                }
                send(new {type="started",id=id}); send(new {type="progress",id=id,offset=0,length=0});
                // A reset returns queued audio immediately. Wait never holds the
                // command lock, and completion comes from the device, not a timer.
                if(sound!=null) sound.Wait();
            } catch(Exception) {if(ticket==generation) error="No se pudo reproducir la voz descargada.";}
            finally {
                lock(gate) {if(process==worker) process=null; if(player==sound) player=null;}
                try {if(sound!=null) sound.Dispose();}
                catch {if(ticket==generation) error="No se pudo liberar el dispositivo de audio.";}
                if(worker!=null) worker.Dispose();
                send(new {type="completed",id=id,cancelled=ticket!=generation,error=error});
            }
        });
    }
    public void Dispose() {Cancel();}
}
