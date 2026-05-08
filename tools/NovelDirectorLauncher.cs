using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

internal static class NovelDirectorLauncher
{
    private const string FallbackProjectPath = @"G:\novel";

    [STAThread]
    private static void Main()
    {
        var projectPath = FindProjectPath();
        if (string.IsNullOrWhiteSpace(projectPath) || !File.Exists(Path.Combine(projectPath, "package.json")))
        {
            MessageBox.Show(
                "没有找到 Novel Director 项目目录。\n\n请把启动器放在项目目录中，或确认项目仍在：\n" + FallbackProjectPath,
                "Novel Director",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
            return;
        }

        try
        {
            var npmCommand = "npm.cmd run dev";
            var arguments = "/k \"cd /d \"" + projectPath + "\" && " + npmCommand + "\"";
            var startInfo = new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = arguments,
                WorkingDirectory = projectPath,
                UseShellExecute = true,
                WindowStyle = ProcessWindowStyle.Normal
            };

            Process.Start(startInfo);
        }
        catch (Exception error)
        {
            MessageBox.Show(
                "启动 Novel Director 失败：\n" + error.Message,
                "Novel Director",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
        }
    }

    private static string FindProjectPath()
    {
        var current = AppDomain.CurrentDomain.BaseDirectory;
        for (var i = 0; i < 4 && !string.IsNullOrWhiteSpace(current); i++)
        {
            if (File.Exists(Path.Combine(current, "package.json")) &&
                Directory.Exists(Path.Combine(current, "src")))
            {
                return current;
            }

            var parent = Directory.GetParent(current);
            current = parent == null ? string.Empty : parent.FullName;
        }

        return Directory.Exists(FallbackProjectPath) ? FallbackProjectPath : string.Empty;
    }
}
