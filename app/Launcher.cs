using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;
[assembly: System.Reflection.AssemblyTitle("Cutline")]
[assembly: System.Reflection.AssemblyProduct("Cutline")]
public class Launcher {
    public static string ResolveProject(string home, string[] args, string documents) {
        if(args.Length>0) {
            string explicitFolder=Path.GetFullPath(args[0]);
            if(!Directory.Exists(explicitFolder))throw new Exception("Project folder does not exist: "+explicitFolder);
            return explicitFolder;
        }
        string destination=Path.Combine(documents,"Cutline","sample-project");
        if(!Directory.Exists(destination)) {
            Directory.CreateDirectory(Path.GetDirectoryName(destination));
            string staging=destination+".copy-"+Guid.NewGuid().ToString("N");
            try {
                CopyTree(Path.Combine(home,"sample-project"),staging);
                foreach(string name in new string[]{"tools","out"}) {
                    string target=Path.Combine(Path.GetDirectoryName(destination),name);
                    if(Directory.Exists(Path.Combine(home,name))&&!Directory.Exists(target))CopyTree(Path.Combine(home,name),target);
                }
                string package=Path.Combine(Path.GetDirectoryName(destination),"package.json");
                if(File.Exists(Path.Combine(home,"package.json"))&&!File.Exists(package))File.Copy(Path.Combine(home,"package.json"),package);
                Directory.Move(staging,destination);
            }
            finally {if(Directory.Exists(staging))Directory.Delete(staging,true);}
        }
        return destination;
    }
    static void CopyTree(string source,string target) {
        Directory.CreateDirectory(target);
        foreach(string file in Directory.GetFiles(source))File.Copy(file,Path.Combine(target,Path.GetFileName(file)));
        foreach(string dir in Directory.GetDirectories(source))CopyTree(dir,Path.Combine(target,Path.GetFileName(dir)));
    }
    [STAThread] static void Main(string[] args) {
        try {
            string home=AppDomain.CurrentDomain.BaseDirectory;
            string documents=Environment.GetEnvironmentVariable("CUTLINE_DOCUMENTS") ?? Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
            string project=ResolveProject(home,args,documents);
            if(!Directory.Exists(project))throw new Exception("Project folder does not exist: "+project);
            var start=new ProcessStartInfo(Path.Combine(home,"VSCodium.exe"));
            start.UseShellExecute=false;
            start.WorkingDirectory=home;
            start.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
            start.EnvironmentVariables["VSCODE_PORTABLE"]=Path.Combine(home,"data");
            start.EnvironmentVariables["CUTLINE_CACHE_ROOT"]=Environment.GetEnvironmentVariable("CUTLINE_CACHE_ROOT") ?? Path.Combine(home,"data","cache");
            Directory.CreateDirectory(Path.Combine(home,"data","tmp"));
            start.EnvironmentVariables["TEMP"]=Path.Combine(home,"data","tmp");
            start.EnvironmentVariables["TMP"]=Path.Combine(home,"data","tmp");
            string quotedProject=project.EndsWith("\\")?project+"\\":project;
            start.Arguments="--new-window --skip-welcome --skip-release-notes --disable-updates --disable-telemetry \""+quotedProject+"\"";
            Process.Start(start);
        } catch(Exception e) {MessageBox.Show(e.Message,"Cutline");}
    }
}
