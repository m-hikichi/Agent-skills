using DesktopPet.Models;
using SkiaSharp;

namespace DesktopPet.Tests;

/// <summary>テスト用アトラス画像（1536×1872、透明背景）の生成ヘルパー。</summary>
internal static class TestAtlas
{
    public static void WritePng(string path, Action<SKBitmap>? draw = null,
        int width = AnimationTable.AtlasWidth, int height = AnimationTable.AtlasHeight)
        => Write(path, SKEncodedImageFormat.Png, draw, width, height);

    public static void WriteWebp(string path, Action<SKBitmap>? draw = null,
        int width = AnimationTable.AtlasWidth, int height = AnimationTable.AtlasHeight)
        => Write(path, SKEncodedImageFormat.Webp, draw, width, height);

    private static void Write(string path, SKEncodedImageFormat format,
        Action<SKBitmap>? draw, int width, int height)
    {
        var info = new SKImageInfo(width, height, SKColorType.Bgra8888, SKAlphaType.Unpremul);
        using var bitmap = new SKBitmap(info);
        bitmap.Erase(SKColors.Transparent);
        draw?.Invoke(bitmap);

        using var image = SKImage.FromBitmap(bitmap);
        using var data = image.Encode(format, 100)
            ?? throw new InvalidOperationException($"encode failed: {format}");
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllBytes(path, data.ToArray());
    }
}

/// <summary>テストごとに破棄される一時ディレクトリ。</summary>
internal sealed class TempDir : IDisposable
{
    public string Path { get; } =
        System.IO.Path.Combine(System.IO.Path.GetTempPath(), "desktop-pet-tests", Guid.NewGuid().ToString("N"));

    public TempDir() => Directory.CreateDirectory(Path);

    public string Combine(params string[] parts) =>
        System.IO.Path.Combine([Path, .. parts]);

    public void Dispose()
    {
        try
        {
            Directory.Delete(Path, recursive: true);
        }
        catch
        {
            // 一時ファイル削除の失敗はテスト結果に影響させない
        }
    }
}
