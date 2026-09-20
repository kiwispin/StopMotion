param(
  [Parameter(Mandatory=$true)][string]$MediaPath,
  [int]$Width = 640,
  [int]$Height = 360,
  [int]$Threads = 0,
  [int]$TimeoutSeconds = 90
)
# Bounded libvlc display-callback probe for longer clips. Each locked frame buffer is
# released as soon as it has been displayed, so memory does not grow with duration.
# Must run under ARM64 PowerShell to load the installed ARM64 libvlc.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Threading;
public static class VlcRenderBounded {
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
    public class Result {
        public int exitState; public long lengthMs; public Stats stats;
        public int lockCount; public int displayCount; public int freed; public int distinctPictures;
        public int[] firstRGB; public int[] lastRGB; public long elapsedMs;
        public long maxBuffersAlive;
    }
    public static Result Run(string file, int width, int height, int threads, int timeoutSeconds) {
        SetDllDirectory("C:/Program Files/VideoLAN/VLC");
        string[] options = {"--ignore-config","--no-one-instance","--no-media-library","--aout=dummy","--vout=vmem","--verbose=2","--avcodec-threads="+threads};
        var args = new IntPtr[options.Length];
        IntPtr argv = Marshal.AllocHGlobal(IntPtr.Size * args.Length);
        for (int i=0;i<args.Length;i++){ args[i]=Marshal.StringToCoTaskMemUTF8(options[i]); Marshal.WriteIntPtr(argv,i*IntPtr.Size,args[i]); }
        IntPtr instance=libvlc_new(args.Length,argv);
        foreach(var arg in args) Marshal.FreeCoTaskMem(arg);
        Marshal.FreeHGlobal(argv);
        if (instance==IntPtr.Zero) throw new Exception("libvlc_new failed");
        IntPtr media=libvlc_media_new_path(instance,file);
        IntPtr player=libvlc_media_player_new_from_media(media);
        var sync=new object();
        var hashes=new Dictionary<IntPtr,string>();
        var alive=new HashSet<IntPtr>();
        var distinct=new HashSet<string>();
        int lockCount=0, displayCount=0, freed=0; long maxAlive=0;
        int[] first=null, last=null;
        int bytes=checked(width*height*4);
        Lock onLock=(opaque,planes)=>{ var data=Marshal.AllocHGlobal(bytes); lock(sync){ alive.Add(data); lockCount++; if(alive.Count>maxAlive) maxAlive=alive.Count; } Marshal.WriteIntPtr(planes,data); return data; };
        Unlock onUnlock=(opaque,picture,planes)=>{
            var data=new byte[bytes]; Marshal.Copy(picture,data,0,bytes);
            var hash=Convert.ToHexString(SHA256.HashData(data));
            lock(sync){ hashes[picture]=hash; }
        };
        Display onDisplay=(opaque,picture)=>{
            int pixel=((height-10)*width+width-10)*4;
            var rgb=new int[]{Marshal.ReadByte(picture,pixel+2),Marshal.ReadByte(picture,pixel+1),Marshal.ReadByte(picture,pixel)};
            lock(sync){
                if(hashes.ContainsKey(picture)){ distinct.Add(hashes[picture]); hashes.Remove(picture); }
                if(first==null) first=rgb; last=rgb;
                displayCount++;
                if(alive.Remove(picture)){ Marshal.FreeHGlobal(picture); freed++; }
            }
        };
        libvlc_video_set_callbacks(player,onLock,onUnlock,onDisplay,IntPtr.Zero);
        libvlc_video_set_format(player,"RV32",(uint)width,(uint)height,(uint)(width*4));
        var clock=Stopwatch.StartNew();
        int status=libvlc_media_player_play(player), state=0;
        if(status!=0) throw new Exception("libvlc play failed");
        while(clock.ElapsedMilliseconds < timeoutSeconds*1000L){
            Thread.Sleep(20); state=libvlc_media_player_get_state(player);
            if(state==6 || state==7) break;
        }
        Thread.Sleep(500);
        libvlc_media_get_stats(media,out Stats stats);
        long length=libvlc_media_player_get_length(player);
        libvlc_media_player_stop(player); libvlc_media_player_release(player);
        libvlc_media_release(media); libvlc_release(instance);
        GC.KeepAlive(onLock); GC.KeepAlive(onUnlock); GC.KeepAlive(onDisplay);
        lock(sync){ foreach(var p in alive) Marshal.FreeHGlobal(p); freed+=alive.Count; alive.Clear(); }
        return new Result{exitState=state,lengthMs=length,stats=stats,lockCount=lockCount,
            displayCount=displayCount,freed=freed,distinctPictures=distinct.Count,firstRGB=first,lastRGB=last,
            elapsedMs=clock.ElapsedMilliseconds,maxBuffersAlive=maxAlive};
    }
}
'@
$result = [VlcRenderBounded]::Run([System.IO.Path]::GetFullPath($MediaPath),$Width,$Height,$Threads,$TimeoutSeconds)
$result | ConvertTo-Json -Depth 6 -Compress
