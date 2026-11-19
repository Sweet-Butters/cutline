using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;
[assembly: System.Reflection.AssemblyTitle("Cutline")]
[assembly: System.Reflection.AssemblyProduct("Cutline")]
class Launcher {
    [STAThread] static void Main(string[] args) {
        try {
            string home=AppDomain.CurrentDomain.BaseDirectory;
            string project=args.Length>0?Path.GetFullPath(args[0]):Path.Combine(home,"sample-project");
            if(!Directory.Exists(project))throw new Exception("Project folder does not exist: "+project);
            var start=new ProcessStartInfo(Path.Combine(home,"VSCodium.exe"));
            start.UseShellExecute=false;
            start.WorkingDirectory=home;
            start.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
            start.EnvironmentVariables["VSCODE_PORTABLE"]=Path.Combine(home,"data");
            Directory.CreateDirectory(Path.Combine(home,"data","tmp"));
            start.EnvironmentVariables["TEMP"]=Path.Combine(home,"data","tmp");
            start.EnvironmentVariables["TMP"]=Path.Combine(home,"data","tmp");
            start.Arguments="--new-window --skip-welcome --skip-release-notes --disable-updates --disable-telemetry \""+project+"\"";
            Process.Start(start);
        } catch(Exception e) {MessageBox.Show(e.Message,"Cutline");}
    }
}
