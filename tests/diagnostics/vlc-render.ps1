param([Parameter(Mandatory=$true)][string]$MediaPath, [int]$Width=640, [int]$Height=480, [int]$Threads=0, [string]$OutputDirectory='')
# ARM64 PowerShell matches the installed ARM64 libvlc. No package installation.
# vmem display callbacks measure actual output pictures, not exit status/first-picture logs.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Threading;
public static class VlcRenderProbe {
    const string Dll = "C:/Program Files/VideoLAN/VLC/libvlc.dll";
    [DllImport("kernel32", CharSet=CharSet.Unicode)] static extern bool SetDllDirectory(string path);
    [DllImport(Dll, CallingConvention=CallingConvention.Cdecl)] static extern IntPtr libvlc_new(int argc, IntPtr argv);
    [DllImport(Dll, CallingConvention=CallingConvention.Cdecl)] static extern IntPtr libvlc_media_new_path(IntPtr instance, [MarshalAs(UnmanagedType.LPUTF8Str)] string path);
    [DllImport(Dll, CallingConvention=CallingConvention.Cdecl)] static extern IntPtr libvlc_media_player_new_from_media(IntPtr media);
    [DllImport(Dll, CallingConvention=CallingConvention.Cdecl)] static extern int libvlc_media_player_play(IntPtr player);
    [DllImport(Dll, CallingConvention=CallingConvention.Cdecl)] static extern int libvlc_media_player_get_state(IntPtr player);
    [DllImport(Dll, CallingConvention=CallingConvention.Cdecl)] static extern long libvlc_media_player_get_length(IntPtr player);
    [DllImport(Dll, CallingConvention=CallingConvention.Cdecl)] static extern int libvlc_media_get_stats(IntPtr media, out Stats stats);
    [DllImport(Dll, CallingConvention=CallingConvention.Cdecl)] static extern void libvlc_video_set_format(IntPtr player, string chroma, uint width, uint height, uint pitch);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate IntPtr Lock(IntPtr opaque, IntPtr planes);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate void Unlock(IntPtr opaque, IntPtr picture, IntPtr planes);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate void Display(IntPtr opaque, IntPtr picture);
    [DllImport(Dll, CallingConvention=CallingConvention.Cdecl)] static extern void libvlc_video_set_callbacks(IntPtr player, Lock a, Unlock b, Display c, IntPtr opaque);
    [DllImport(Dll, CallingConvention=CallingConvention.Cdecl)] static extern void libvlc_media_player_stop(IntPtr player);
    [DllImport(Dll, CallingConvention=CallingConvention.Cdecl)] static extern void libvlc_media_player_release(IntPtr player);
    [DllImport(Dll, CallingConvention=CallingConvention.Cdecl)] static extern void libvlc_media_release(IntPtr media);
    [DllImport(Dll, CallingConvention=CallingConvention.Cdecl)] static extern void libvlc_release(IntPtr instance);
    [StructLayout(LayoutKind.Sequential)] public struct Stats {
        public int readbytes; public float inputbitrate;
        public int demuxreadbytes; public float demuxbitrate;
        public int demuxcorrupted, demuxdiscontinuity, decodedvideo, decodedaudio;
        public int displayedpictures, lostpictures, playedabuffers, lostabuffers;
        public int sentpackets, sentbytes; public float sendbitrate;
    }
    public class Picture { public string hash; public long milliseconds; public int[] rgb; }
    public class Result { public int state; public long lengthMs; public Stats stats; public List<Picture> displayed; public int unlocked; }
    public static Result Run(string file, int width, int height, int threads, string output) {
        SetDllDirectory("C:/Program Files/VideoLAN/VLC");
        string[] options = {"--ignore-config", "--no-one-instance", "--no-media-library", "--aout=dummy", "--verbose=2", "--avcodec-threads="+threads};
        var args = new IntPtr[options.Length];
        IntPtr argv = Marshal.AllocHGlobal(IntPtr.Size * args.Length);
        for (int i=0; i<args.Length; i++) { args[i]=Marshal.StringToCoTaskMemUTF8(options[i]); Marshal.WriteIntPtr(argv,i*IntPtr.Size,args[i]); }
        IntPtr instance=libvlc_new(args.Length,argv);
        foreach(var arg in args) Marshal.FreeCoTaskMem(arg);
        Marshal.FreeHGlobal(argv);
        if (instance==IntPtr.Zero) throw new Exception("libvlc_new failed");
        IntPtr media=libvlc_media_new_path(instance,file);
        IntPtr player=libvlc_media_player_new_from_media(media);
        var buffers=new List<IntPtr>(); var hashes=new Dictionary<IntPtr,string>();
        var pictures=new List<Picture>(); var sync=new object(); var clock=Stopwatch.StartNew();
        int bytes=checked(width*height*4), unlocked=0;
        Lock onLock=(opaque,planes)=> { var data=Marshal.AllocHGlobal(bytes); lock(sync) buffers.Add(data); Marshal.WriteIntPtr(planes,data); return data; };
        Unlock onUnlock=(opaque,picture,planes)=> { var data=new byte[bytes]; Marshal.Copy(picture,data,0,bytes); var hash=Convert.ToHexString(SHA256.HashData(data)); lock(sync) { hashes[picture]=hash; unlocked++; } };
        Display onDisplay=(opaque,picture)=> { lock(sync) {
            string hash=hashes[picture];
            int pixel=((height-10)*width+width-10)*4;
            var rgb=new int[] {Marshal.ReadByte(picture,pixel+2),Marshal.ReadByte(picture,pixel+1),Marshal.ReadByte(picture,pixel)};
            if(output.Length>0 && (pictures.Count==0 || pictures[pictures.Count-1].hash!=hash)) {
                var data=new byte[bytes]; Marshal.Copy(picture,data,0,bytes);
                File.WriteAllBytes(Path.Combine(output,hash+".bgra"),data);
            }
            pictures.Add(new Picture {hash=hash,milliseconds=clock.ElapsedMilliseconds,rgb=rgb});
        } };
        libvlc_video_set_callbacks(player,onLock,onUnlock,onDisplay,IntPtr.Zero);
        libvlc_video_set_format(player,"RV32",(uint)width,(uint)height,(uint)(width*4));
        int status=libvlc_media_player_play(player), state=0;
        if(status!=0) throw new Exception("libvlc play failed");
        while(clock.ElapsedMilliseconds<20000) { Thread.Sleep(20); state=libvlc_media_player_get_state(player); if(state==6 || state==7) break; }
        // Ended is an input event, not proof that queued display callbacks finished.
        // Observe the existing output queue before releasing it; do not extend media.
        Thread.Sleep(500);
        libvlc_media_get_stats(media,out Stats stats);
        long length=libvlc_media_player_get_length(player);
        libvlc_media_player_stop(player); libvlc_media_player_release(player);
        libvlc_media_release(media); libvlc_release(instance);
        GC.KeepAlive(onLock); GC.KeepAlive(onUnlock); GC.KeepAlive(onDisplay);
        foreach(var data in buffers) Marshal.FreeHGlobal(data);
        return new Result {state=state,lengthMs=length,stats=stats,displayed=pictures,unlocked=unlocked};
    }
}
'@
$result = [VlcRenderProbe]::Run([System.IO.Path]::GetFullPath($MediaPath),$Width,$Height,$Threads,$OutputDirectory)
$result | ConvertTo-Json -Depth 6 -Compress
