namespace DesktopPet.Services;

/// <summary>
/// 軽量な診断ログ（発見の除外理由・設定I/O失敗など）。
/// 失敗してもアプリの動作に影響させない。
/// </summary>
public static class DiagnosticsLog
{
    private static readonly object Gate = new();

    public static string LogDirectory { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "DesktopPet", "logs");

    public static void Write(string message)
    {
        try
        {
            lock (Gate)
            {
                Directory.CreateDirectory(LogDirectory);
                File.AppendAllText(
                    Path.Combine(LogDirectory, "desktop-pet.log"),
                    $"{DateTimeOffset.Now:yyyy-MM-dd HH:mm:ss zzz} {message}{Environment.NewLine}");
            }
        }
        catch
        {
            // ログ失敗は無視（FR-012: クラッシュさせない）
        }
    }
}
