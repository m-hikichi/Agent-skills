using DesktopPet.Models;
using DesktopPet.Services;
using Xunit;

namespace DesktopPet.Tests;

public class SettingsServiceTests : IDisposable
{
    private readonly TempDir _dir = new();

    public void Dispose() => _dir.Dispose();

    private SettingsService CreateService() => new(_dir.Combine("settings.json"));

    [Fact]
    public void Load_MissingFile_ReturnsDefaults()
    {
        var settings = CreateService().Load();

        Assert.Equal(AppSettings.CurrentSchemaVersion, settings.SchemaVersion);
        Assert.Null(settings.SelectedPetId);
        Assert.Null(settings.PositionX);
        Assert.Null(settings.PositionY);
    }

    [Fact]
    public void SaveAndLoad_RoundTrips()
    {
        var service = CreateService();
        var settings = new AppSettings { SelectedPetId = "cat", PositionX = 100.5, PositionY = -20 };

        Assert.True(service.TrySave(settings, out _));
        var loaded = CreateService().Load();

        Assert.Equal(settings, loaded);
    }

    [Fact]
    public void Save_UsesCamelCasePerContract()
    {
        var service = CreateService();
        service.TrySave(new AppSettings { SelectedPetId = "cat" }, out _);

        var json = File.ReadAllText(service.FilePath);

        Assert.Contains("\"schemaVersion\"", json);
        Assert.Contains("\"selectedPetId\"", json);
    }

    [Theory]
    [InlineData("{ broken json")]
    [InlineData("")]
    [InlineData("[1,2,3]")]
    public void Load_CorruptFile_ReturnsDefaultsWithoutThrowing(string content)
    {
        var service = CreateService();
        File.WriteAllText(service.FilePath, content);

        var settings = service.Load();

        Assert.Null(settings.SelectedPetId);
    }

    [Fact]
    public void Load_FutureSchemaVersion_ReturnsDefaults()
    {
        var service = CreateService();
        File.WriteAllText(service.FilePath,
            """{ "schemaVersion": 99, "selectedPetId": "future-pet" }""");

        var settings = service.Load();

        Assert.Null(settings.SelectedPetId);
    }

    // ---- 表示サイズ（002 FR-016 / FR-021、contracts/app-settings.md の互換表） ----

    [Fact]
    public void SaveAndLoad_RoundTripsAllFourKeys()
    {
        var service = CreateService();
        var settings = new AppSettings
        {
            SelectedPetId = "cat", PositionX = -1200.5, PositionY = 433, ScalePercent = 125,
        };

        Assert.True(service.TrySave(settings, out _));
        var loaded = CreateService().Load();

        Assert.Equal(settings, loaded);
        Assert.Contains("\"scalePercent\": 125", File.ReadAllText(service.FilePath));
        Assert.Equal(CharacterScale.Large, CharacterScales.FromPercent(loaded.ScalePercent));
    }

    [Fact]
    public void Load_LegacyFileWithoutScalePercent_KeepsPositionAndPet()
    {
        var service = CreateService();
        File.WriteAllText(service.FilePath,
            """{ "schemaVersion": 1, "selectedPetId": "genba-neko", "positionX": 1696, "positionY": 792 }""");

        var settings = service.Load();

        Assert.Null(settings.ScalePercent);
        Assert.Equal(CharacterScale.Medium, CharacterScales.FromPercent(settings.ScalePercent));
        Assert.Equal("genba-neko", settings.SelectedPetId);
        Assert.Equal(1696, settings.PositionX);
        Assert.Equal(792, settings.PositionY);
    }

    [Theory]
    [InlineData("110")]
    [InlineData("0")]
    [InlineData("-50")]
    [InlineData("1000")]
    [InlineData("null")]
    public void Load_OutOfRangeScalePercent_ResolvesToMediumAndKeepsTheOtherKeys(string rawValue)
    {
        var service = CreateService();
        File.WriteAllText(service.FilePath,
            $$"""{ "schemaVersion": 1, "selectedPetId": "cat", "positionX": 10, "positionY": 20, "scalePercent": {{rawValue}} }""");

        var settings = service.Load();

        Assert.Equal(CharacterScale.Medium, CharacterScales.FromPercent(settings.ScalePercent));
        Assert.Equal("cat", settings.SelectedPetId);
        Assert.Equal(10, settings.PositionX);
        Assert.Equal(20, settings.PositionY);
    }

    [Theory]
    [InlineData("\"big\"")]
    [InlineData("\"125\"")]
    [InlineData("true")]
    [InlineData("[]")]
    [InlineData("{\"nested\":[1,2]}")]
    [InlineData("125.5")]
    [InlineData("2147483648")]
    public void Load_ScalePercentOfWrongType_KeepsPositionAndPet(string rawValue)
    {
        var service = CreateService();
        File.WriteAllText(service.FilePath,
            $$"""{ "schemaVersion": 1, "scalePercent": {{rawValue}}, "selectedPetId": "cat", "positionX": -900.5, "positionY": 400 }""");

        var settings = service.Load();

        Assert.Equal("cat", settings.SelectedPetId);
        Assert.Equal(-900.5, settings.PositionX);
        Assert.Equal(400, settings.PositionY);
        Assert.Equal(CharacterScale.Medium, CharacterScales.FromPercent(settings.ScalePercent));
    }

    // ---- 位置クランプ（FR-015 / FR-016） ----

    private static readonly ScreenRect Primary = new(0, 0, 1920, 1080);
    private static readonly (double X, double Y) Fallback = (1696, 856);

    [Fact]
    public void Clamp_FullyVisible_IsUnchanged()
    {
        var (x, y) = SettingsService.ClampToScreens(500, 400, 192, 208, [Primary], Fallback);

        Assert.Equal(500, x);
        Assert.Equal(400, y);
    }

    [Fact]
    public void Clamp_PartiallyOffRight_IsClampedToEdge()
    {
        var (x, y) = SettingsService.ClampToScreens(1900, 400, 192, 208, [Primary], Fallback);

        Assert.Equal(1920 - 192, x);
        Assert.Equal(400, y);
    }

    [Fact]
    public void Clamp_NoIntersection_FallsBack()
    {
        var (x, y) = SettingsService.ClampToScreens(5000, 5000, 192, 208, [Primary], Fallback);

        Assert.Equal(Fallback, (x, y));
    }

    [Fact]
    public void Clamp_NoScreens_FallsBack()
    {
        var (x, y) = SettingsService.ClampToScreens(100, 100, 192, 208, [], Fallback);

        Assert.Equal(Fallback, (x, y));
    }

    [Fact]
    public void Clamp_PicksScreenWithLargestIntersection()
    {
        var secondary = new ScreenRect(1920, 0, 1920, 1080);
        // ウィンドウの大部分はセカンダリ側、下に少しはみ出している
        var (x, y) = SettingsService.ClampToScreens(2000, 1000, 192, 208, [Primary, secondary], Fallback);

        Assert.Equal(2000, x);
        Assert.Equal(1080 - 208, y);
    }

    [Fact]
    public void DefaultPosition_IsBottomRightWithMargin()
    {
        var (x, y) = SettingsService.DefaultPosition(Primary, 192, 208, margin: 32);

        Assert.Equal(1920 - 192 - 32, x);
        Assert.Equal(1080 - 208 - 32, y);
    }
}
