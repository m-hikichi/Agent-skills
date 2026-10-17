using System.Text.Json;
using DesktopPet.Models;

namespace DesktopPet.Services;

/// <summary>
/// settings.json の読み書き（contracts/app-settings.md）。
/// 読み込みは常に成功する（壊れていれば既定値）。書き込みはアトミック置換。
/// </summary>
public sealed class SettingsService
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = true,
        AllowTrailingCommas = true,
    };

    private readonly string _filePath;

    public SettingsService(string? filePath = null)
    {
        _filePath = filePath ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "DesktopPet", "settings.json");
    }

    public string FilePath => _filePath;

    /// <summary>失敗してもスローせず既定値を返す。未知の将来スキーマも既定値で続行する。</summary>
    public AppSettings Load()
    {
        try
        {
            if (!File.Exists(_filePath))
            {
                return new AppSettings();
            }
            var json = File.ReadAllText(_filePath);
            var settings = JsonSerializer.Deserialize<AppSettings>(json, JsonOptions);
            if (settings is null || settings.SchemaVersion > AppSettings.CurrentSchemaVersion)
            {
                return new AppSettings();
            }
            return settings;
        }
        catch
        {
            return new AppSettings();
        }
    }

    /// <summary>一時ファイル経由のアトミック置換。失敗してもスローしない。</summary>
    public bool TrySave(AppSettings settings, out string? error)
    {
        try
        {
            var dir = Path.GetDirectoryName(_filePath)!;
            Directory.CreateDirectory(dir);
            var tmp = _filePath + ".tmp";
            File.WriteAllText(tmp, JsonSerializer.Serialize(settings, JsonOptions));
            File.Move(tmp, _filePath, overwrite: true);
            error = null;
            return true;
        }
        catch (Exception ex)
        {
            error = ex.Message;
            return false;
        }
    }

    /// <summary>プライマリ作業領域の右下既定位置（マージン付き）。</summary>
    public static (double X, double Y) DefaultPosition(
        ScreenRect primaryWorkArea, double windowWidth, double windowHeight, double margin = 32)
    {
        return (primaryWorkArea.Right - windowWidth - margin,
                primaryWorkArea.Bottom - windowHeight - margin);
    }

    /// <summary>
    /// 保存位置をスクリーン群へクランプする。どのスクリーンとも交差しない場合は
    /// fallback（既定位置）を返す（FR-015 / FR-016）。
    /// </summary>
    public static (double X, double Y) ClampToScreens(
        double x, double y, double windowWidth, double windowHeight,
        IReadOnlyList<ScreenRect> screens, (double X, double Y) fallback)
    {
        if (screens.Count == 0)
        {
            return fallback;
        }

        // 交差面積が最大のスクリーンを選ぶ
        ScreenRect? best = null;
        double bestArea = 0;
        foreach (var s in screens)
        {
            var ix = Math.Max(0, Math.Min(x + windowWidth, s.Right) - Math.Max(x, s.X));
            var iy = Math.Max(0, Math.Min(y + windowHeight, s.Bottom) - Math.Max(y, s.Y));
            var area = ix * iy;
            if (area > bestArea)
            {
                bestArea = area;
                best = s;
            }
        }

        if (best is null)
        {
            return fallback;
        }

        var b = best.Value;
        var clampedX = Math.Clamp(x, b.X, Math.Max(b.X, b.Right - windowWidth));
        var clampedY = Math.Clamp(y, b.Y, Math.Max(b.Y, b.Bottom - windowHeight));
        return (clampedX, clampedY);
    }
}
