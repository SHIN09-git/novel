using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

internal static class NovelDirectorLauncher
{
    private const string ProjectPathEnvironmentVariable = "NOVEL_DIRECTOR_PROJECT_PATH";

    [STAThread]
    private static void Main()
    {
        var projectPath = FindProjectPath();
        if (string.IsNullOrWhiteSpace(projectPath) || !File.Exists(Path.Combine(projectPath, "package.json")))
        {
            MessageBox.Show(
                "没有找到 Novel Director 项目目录。\n\n请把启动器放在项目目录中，或设置环境变量 " + ProjectPathEnvironmentVariable + " 指向项目目录。",
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
        var configured = Environment.GetEnvironmentVariable(ProjectPathEnvironmentVariable);
        if (IsProjectDirectory(configured))
        {
            return configured;
        }

        var current = AppDomain.CurrentDomain.BaseDirectory;
        for (var i = 0; i < 8 && !string.IsNullOrWhiteSpace(current); i++)
        {
            if (IsProjectDirectory(current))
            {
                return current;
            }

            var parent = Directory.GetParent(current);
            current = parent == null ? string.Empty : parent.FullName;
        }

        return string.Empty;
    }

    private static bool IsProjectDirectory(string path)
    {
        return !string.IsNullOrWhiteSpace(path) &&
            Directory.Exists(path) &&
            File.Exists(Path.Combine(path, "package.json")) &&
            Directory.Exists(Path.Combine(path, "src"));
    }
}
