using DesktopPet.Models;
using DesktopPet.Services;
using Xunit;

namespace DesktopPet.Tests;

public class CharacterLayoutTests
{
    private static readonly double[] Scalings = [1.0, 1.25, 1.5, 2.0];
    private static readonly ScreenRect Primary = new(0, 0, 1920, 1040);

    // プライマリの左（負のX）と上（負のY）に置かれたモニタも含める
    public static TheoryData<double, double, double> AnchorsAndScalings()
    {
        var data = new TheoryData<double, double, double>();
        foreach (var scaling in Scalings)
        {
            data.Add(800.0, 600.0, scaling);
            data.Add(-1200.5, 433.25, scaling);
            data.Add(310.0, -720.75, scaling);
        }
        return data;
    }

    [Fact]
    public void SizeDip_IsCellSizeTimesFactor()
    {
        Assert.Equal(new DipSize(144, 156), CharacterLayout.SizeDip(CharacterScale.Small));
        Assert.Equal(new DipSize(192, 208), CharacterLayout.SizeDip(CharacterScale.Medium));
        Assert.Equal(new DipSize(240, 260), CharacterLayout.SizeDip(CharacterScale.Large));
        Assert.Equal(new DipSize(288, 312), CharacterLayout.SizeDip(CharacterScale.XLarge));
    }

    [Theory]
    [MemberData(nameof(AnchorsAndScalings))]
    public void FeetAnchor_StaysPutAcrossEveryScaleSwitch(double x, double y, double scaling)
    {
        var position = new CharacterPosition(x, y);

        foreach (var from in CharacterScales.All)
        {
            foreach (var to in CharacterScales.All)
            {
                // 導出した矩形の下辺中央は、サイズを切り替えても同じ点を指す
                var before = CharacterLayout.BoundsPx(position, from, scaling);
                var after = CharacterLayout.BoundsPx(position, to, scaling);

                Assert.Equal(before.X + before.Width / 2, after.X + after.Width / 2, precision: 9);
                Assert.Equal(before.Bottom, after.Bottom, precision: 9);
                Assert.Equal(x, after.X + after.Width / 2, precision: 9);
                Assert.Equal(y, after.Bottom, precision: 9);
            }
        }
    }

    [Fact]
    public void HundredScaleSwitches_LeaveThePositionBitIdentical()
    {
        // 位置は導出するだけで書き戻さないので、丸め誤差が累積しない（SC-010）
        var position = new CharacterPosition(1234.37, 567.81);
        var original = position;

        for (var i = 0; i < 100; i++)
        {
            var scale = CharacterScales.All[i % CharacterScales.All.Count];
            var topLeft = CharacterLayout.TopLeft(position, scale, 1.25);
            _ = CharacterLayout.RoundToPixel(topLeft);
        }

        Assert.Equal(original, position);
    }

    [Theory]
    [MemberData(nameof(AnchorsAndScalings))]
    public void TopLeftAndAnchorFromTopLeft_RoundTrip(double x, double y, double scaling)
    {
        var position = new CharacterPosition(x, y);

        foreach (var scale in CharacterScales.All)
        {
            var topLeft = CharacterLayout.TopLeft(position, scale, scaling);
            var restored = CharacterLayout.AnchorFromTopLeft(topLeft, scale, scaling);

            Assert.Equal(position.X, restored.X, precision: 9);
            Assert.Equal(position.Y, restored.Y, precision: 9);
        }
    }

    [Theory]
    [MemberData(nameof(AnchorsAndScalings))]
    public void GrabOffsetAndPositionFromCursor_RoundTrip(double x, double y, double scaling)
    {
        var position = new CharacterPosition(x, y);
        var cursor = new ScreenPoint(x + 37.5, y - 90.25);

        var grab = CharacterLayout.GrabOffsetDip(cursor, position, scaling);
        var restored = CharacterLayout.PositionFromCursor(cursor, grab, scaling);

        Assert.Equal(position.X, restored.X, precision: 9);
        Assert.Equal(position.Y, restored.Y, precision: 9);
    }

    [Fact]
    public void GrabOffset_KeepsTheSameBodyPartWhenScalingChanges()
    {
        // 倍率 1.0 でつかんだ部位（DIP）は、倍率 1.5 のモニタへ入っても同じ DIP のまま
        var position = new CharacterPosition(1000, 800);
        var grab = CharacterLayout.GrabOffsetDip(new ScreenPoint(1040, 700), position, 1.0);
        Assert.Equal(new DipVector(40, -100), grab);

        var moved = CharacterLayout.PositionFromCursor(new ScreenPoint(2500, 700), grab, 1.5);

        Assert.Equal(new CharacterPosition(2500 - 60, 700 + 150), moved);
    }

    [Fact]
    public void DeltaDip_DividesThePixelDifferenceByScaling()
    {
        var delta = CharacterLayout.DeltaDip(new ScreenPoint(-300, 50), new ScreenPoint(-306, 59), 1.5);

        Assert.Equal(new DipVector(-4, 6), delta);
    }

    [Fact]
    public void ClientDipToScreen_ScalesTheWindowLocalOffset()
    {
        var point = CharacterLayout.ClientDipToScreen(new ScreenPoint(-500, 200), new DipVector(10, 20), 1.25);

        Assert.Equal(new ScreenPoint(-487.5, 225), point);
    }

    [Fact]
    public void CorrectIfOverflowing_ReturnsTheSameValueWhenInside()
    {
        var position = new CharacterPosition(960, 700);

        foreach (var scale in CharacterScales.All)
        {
            Assert.Equal(position, CharacterLayout.CorrectIfOverflowing(position, scale, 1.0, [Primary]));
        }
    }

    [Fact]
    public void CorrectIfOverflowing_PullsBackOnlyWhenTheRectLeavesTheWorkArea()
    {
        // Medium (192×208) なら右下の端にちょうど収まる位置
        var position = new CharacterPosition(1920 - 96, 1040);
        Assert.Equal(position, CharacterLayout.CorrectIfOverflowing(position, CharacterScale.Medium, 1.0, [Primary]));

        // X-Large (288×312) にすると右へ 48px はみ出すので、その分だけ左へ戻る
        var corrected = CharacterLayout.CorrectIfOverflowing(position, CharacterScale.XLarge, 1.0, [Primary]);

        Assert.Equal(new CharacterPosition(1920 - 144, 1040), corrected);
        Assert.Equal(0, CharacterLayout.OverflowArea(
            CharacterLayout.BoundsPx(corrected, CharacterScale.XLarge, 1.0), [Primary]), precision: 6);
    }

    [Fact]
    public void CorrectIfOverflowing_KeepsThePetOutFromUnderTheTaskbar()
    {
        // 作業領域の下端（タスクバーの上端）を足元が越えている
        var position = new CharacterPosition(500, 1060);

        var corrected = CharacterLayout.CorrectIfOverflowing(position, CharacterScale.Medium, 1.0, [Primary]);

        Assert.Equal(new CharacterPosition(500, 1040), corrected);
    }

    [Fact]
    public void RectStraddlingTwoAdjacentWorkAreas_IsNotOverflowing()
    {
        var left = new ScreenRect(-1920, 0, 1920, 1040);
        var position = new CharacterPosition(0, 600); // 2台の境界の真上

        Assert.Equal(0, CharacterLayout.OverflowArea(
            CharacterLayout.BoundsPx(position, CharacterScale.XLarge, 1.0), [left, Primary]), precision: 6);
        Assert.Equal(position, CharacterLayout.CorrectIfOverflowing(position, CharacterScale.XLarge, 1.0, [left, Primary]));
    }

    [Fact]
    public void CorrectIfOverflowing_UsesTheNearestWorkAreaWhenNothingIntersects()
    {
        var position = new CharacterPosition(5000, 5000);

        var corrected = CharacterLayout.CorrectIfOverflowing(position, CharacterScale.Medium, 1.0, [Primary]);

        Assert.Equal(new CharacterPosition(1920 - 96, 1040), corrected);
    }

    [Fact]
    public void CorrectIfOverflowing_WithNoWorkAreas_LeavesThePositionAlone()
    {
        var position = new CharacterPosition(5000, 5000);

        Assert.Equal(position, CharacterLayout.CorrectIfOverflowing(position, CharacterScale.Medium, 1.0, []));
    }

    [Theory]
    [InlineData(CharacterScale.Small, 1.0)]
    [InlineData(CharacterScale.Medium, 1.25)]
    [InlineData(CharacterScale.Large, 1.5)]
    [InlineData(CharacterScale.XLarge, 2.0)]
    public void ToSourcePixel_MapsTheDisplayedRectOntoTheSourceCell(CharacterScale scale, double scaling)
    {
        var topLeft = new ScreenPoint(-400, 300);
        var bounds = CharacterLayout.BoundsPx(
            CharacterLayout.AnchorFromTopLeft(topLeft, scale, scaling), scale, scaling);

        // 左上の隅 → (0,0)、表示矩形の中央 → セルの中央、右下の隅の内側 → (191,207)
        Assert.Equal((0, 0), CharacterLayout.ToSourcePixel(topLeft, topLeft, scale, scaling));
        Assert.Equal((96, 104), CharacterLayout.ToSourcePixel(
            new ScreenPoint(topLeft.X + bounds.Width / 2, topLeft.Y + bounds.Height / 2), topLeft, scale, scaling));
        Assert.Equal((191, 207), CharacterLayout.ToSourcePixel(
            new ScreenPoint(bounds.Right - 0.01, bounds.Bottom - 0.01), topLeft, scale, scaling));
    }

    [Fact]
    public void ToSourcePixel_ReportsOutsideTheDisplayedRect()
    {
        var topLeft = new ScreenPoint(100, 100);

        Assert.Null(CharacterLayout.ToSourcePixel(new ScreenPoint(99.9, 150), topLeft, CharacterScale.Small, 1.0));
        Assert.Null(CharacterLayout.ToSourcePixel(new ScreenPoint(150, 99.9), topLeft, CharacterScale.Small, 1.0));
        // Small は 144×156 px。Medium なら内側になる点も、Small では外側
        Assert.Null(CharacterLayout.ToSourcePixel(new ScreenPoint(100 + 144, 150), topLeft, CharacterScale.Small, 1.0));
        Assert.NotNull(CharacterLayout.ToSourcePixel(new ScreenPoint(100 + 144, 150), topLeft, CharacterScale.Medium, 1.0));
    }

    [Theory]
    [InlineData(10.4, -3.4, 10, -3)]
    [InlineData(10.5, -3.5, 11, -4)]
    [InlineData(10.6, -3.6, 11, -4)]
    public void RoundToPixel_RoundsHalfAwayFromZero(double x, double y, int expectedX, int expectedY)
    {
        Assert.Equal((expectedX, expectedY), CharacterLayout.RoundToPixel(new ScreenPoint(x, y)));
    }

    [Theory]
    [InlineData(CharacterScale.Medium, 1.0, SpriteInterpolation.Nearest)]
    [InlineData(CharacterScale.Medium, 1.25, SpriteInterpolation.Nearest)] // Medium は 001 と同じ描画
    [InlineData(CharacterScale.Medium, 1.5, SpriteInterpolation.Nearest)]
    [InlineData(CharacterScale.Small, 1.0, SpriteInterpolation.HighQuality)]
    [InlineData(CharacterScale.Large, 1.0, SpriteInterpolation.HighQuality)]
    [InlineData(CharacterScale.XLarge, 1.0, SpriteInterpolation.HighQuality)]
    [InlineData(CharacterScale.XLarge, 2.0, SpriteInterpolation.Nearest)] // 実効 3.0 倍
    [InlineData(CharacterScale.Small, 4.0, SpriteInterpolation.Nearest)] // 実効 3.0 倍
    public void InterpolationFor_UsesNearestOnlyForMediumOrIntegerEffectiveScale(
        CharacterScale scale, double scaling, SpriteInterpolation expected)
    {
        Assert.Equal(expected, CharacterLayout.InterpolationFor(scale, scaling));
    }
}
