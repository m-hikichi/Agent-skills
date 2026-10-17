using DesktopPet.Models;
using DesktopPet.Services;
using SkiaSharp;
using Xunit;

namespace DesktopPet.Tests;

public class SpriteSheetLoaderTests : IDisposable
{
    private readonly TempDir _dir = new();

    public void Dispose() => _dir.Dispose();

    [Fact]
    public void TryLoad_ValidPng_ProducesFramesPerContract()
    {
        var path = _dir.Combine("atlas.png");
        TestAtlas.WritePng(path);

        Assert.True(SpriteSheetLoader.TryLoad(path, out var sheet, out var error));
        Assert.Null(error);

        foreach (var row in AnimationTable.All)
        {
            Assert.Equal(row.FrameCount, sheet!.Frames[row.State].Length);
        }
    }

    [Fact]
    public void TryLoad_OpaquePixelsAreMappedToCorrectCellAndPosition()
    {
        var path = _dir.Combine("atlas.png");
        TestAtlas.WritePng(path, bitmap =>
        {
            // idle(row0) frame0 のセル内座標 (10, 20)
            bitmap.SetPixel(10, 20, new SKColor(255, 0, 0, 255));
            // running-right(row1) frame7 のセル内座標 (5, 7)
            bitmap.SetPixel(7 * AnimationTable.CellWidth + 5, 1 * AnimationTable.CellHeight + 7,
                new SKColor(0, 255, 0, 255));
        });

        Assert.True(SpriteSheetLoader.TryLoad(path, out var sheet, out _));

        var idleFrame = sheet!.GetFrame(PetState.Idle, 0);
        Assert.True(idleFrame.Opaque[20 * AnimationTable.CellWidth + 10]);
        Assert.False(idleFrame.Opaque[0]);

        var runFrame = sheet.GetFrame(PetState.RunningRight, 7);
        Assert.True(runFrame.Opaque[7 * AnimationTable.CellWidth + 5]);

        // 他のコマには漏れていない
        var runFrame0 = sheet.GetFrame(PetState.RunningRight, 0);
        Assert.False(runFrame0.Opaque[7 * AnimationTable.CellWidth + 5]);
    }

    [Fact]
    public void TryLoad_Webp_IsSupported()
    {
        var path = _dir.Combine("atlas.webp");
        TestAtlas.WriteWebp(path, bitmap => bitmap.SetPixel(10, 20, new SKColor(255, 0, 0, 255)));

        Assert.True(SpriteSheetLoader.TryLoad(path, out var sheet, out var error));
        Assert.Null(error);
        Assert.True(sheet!.GetFrame(PetState.Idle, 0).Opaque[20 * AnimationTable.CellWidth + 10]);
    }

    [Fact]
    public void TryLoad_WrongDimensions_FailsWithReason()
    {
        var path = _dir.Combine("atlas.png");
        TestAtlas.WritePng(path, width: 800, height: 600);

        Assert.False(SpriteSheetLoader.TryLoad(path, out var sheet, out var error));
        Assert.Null(sheet);
        Assert.Contains("1536", error);
    }

    [Fact]
    public void TryLoad_NotAnImage_FailsWithoutThrowing()
    {
        var path = _dir.Combine("broken.webp");
        File.WriteAllText(path, "this is not an image");

        Assert.False(SpriteSheetLoader.TryLoad(path, out _, out var error));
        Assert.NotNull(error);
    }

    [Fact]
    public void TryValidateDimensions_ChecksWithoutFullDecode()
    {
        var valid = _dir.Combine("ok.png");
        TestAtlas.WritePng(valid);
        Assert.True(SpriteSheetLoader.TryValidateDimensions(valid, out _));

        var wrong = _dir.Combine("wrong.png");
        TestAtlas.WritePng(wrong, width: 100, height: 100);
        Assert.False(SpriteSheetLoader.TryValidateDimensions(wrong, out var error));
        Assert.Contains("100", error);

        var broken = _dir.Combine("broken.png");
        File.WriteAllText(broken, "nope");
        Assert.False(SpriteSheetLoader.TryValidateDimensions(broken, out _));
    }

    [Fact]
    public void Premultiply_ScalesColorByAlphaAndKeepsAlpha()
    {
        byte[] bgra =
        [
            10, 200, 255, 255, // 不透明: 色はそのまま
            10, 200, 255, 0,   // 完全透明: 色は 0（透明画素の色が輪郭へ混ざらない）
            100, 200, 255, 128, // 半透明: 色 × 128 ÷ 255 を四捨五入
        ];

        var result = SpriteSheetLoader.Premultiply(bgra);

        Assert.Equal(
            new byte[] { 10, 200, 255, 255, 0, 0, 0, 0, 50, 100, 128, 128 },
            result);
        Assert.Equal(new byte[] { 10, 200, 255, 255 }, bgra[..4]); // 入力は書き換えない
    }
}
