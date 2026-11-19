using System;
using System.IO;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class BrandIcon {
    delegate bool EnumName(IntPtr module,IntPtr type,IntPtr name,IntPtr param);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr LoadLibraryEx(string file,IntPtr reserved,uint flags);
    [DllImport("kernel32.dll")] static extern bool FreeLibrary(IntPtr module);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern bool EnumResourceNames(IntPtr module,IntPtr type,EnumName callback,IntPtr param);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr BeginUpdateResource(string file,bool delete);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool UpdateResource(IntPtr handle,IntPtr type,IntPtr name,ushort language,byte[] data,uint size);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool EndUpdateResource(IntPtr handle,bool discard);
    public static void Replace(string exe,string ico) {
        var groups=new List<int>();IntPtr module=LoadLibraryEx(exe,IntPtr.Zero,2);
        if(module==IntPtr.Zero)throw new Exception("Cannot inspect executable resources");
        EnumName callback=(m,t,n,p)=>{if(n.ToInt64()<=65535)groups.Add(n.ToInt32());else throw new Exception("Unexpected named icon group");return true;};
        EnumResourceNames(module,(IntPtr)14,callback,IntPtr.Zero);FreeLibrary(module);
        if(groups.Count==0)throw new Exception("Executable has no icon group");
        byte[] bytes=File.ReadAllBytes(ico);ushort count=BitConverter.ToUInt16(bytes,4);
        var stream=new MemoryStream();var writer=new BinaryWriter(stream);writer.Write((ushort)0);writer.Write((ushort)1);writer.Write(count);
        IntPtr update=BeginUpdateResource(exe,false);if(update==IntPtr.Zero)throw new Exception("Cannot update executable");
        bool success=false;
        try {
            for(int i=0;i<count;i++) {
                int offset=6+i*16;uint size=BitConverter.ToUInt32(bytes,offset+8);uint start=BitConverter.ToUInt32(bytes,offset+12);
                byte[] data=new byte[size];Array.Copy(bytes,start,data,0,size);
                // Use fresh IDs so no upstream language-specific icon can shadow these images.
                ushort id=(ushort)(500+i);writer.Write(bytes,offset,12);writer.Write(id);
                if(!UpdateResource(update,(IntPtr)3,(IntPtr)id,0,data,size))throw new Exception("Icon update failed");
            }
            byte[] group=stream.ToArray();
            foreach(int id in groups)foreach(ushort language in new ushort[]{0,1033})
                if(!UpdateResource(update,(IntPtr)14,(IntPtr)id,language,group,(uint)group.Length))throw new Exception("Icon group update failed");
            success=true;
        } finally {if(!EndUpdateResource(update,!success))throw new Exception("Resource commit failed");}
    }
}
