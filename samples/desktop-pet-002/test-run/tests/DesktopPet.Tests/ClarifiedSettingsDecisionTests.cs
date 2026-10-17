using DesktopPet.Models;
using DesktopPet.Services;
using Xunit;

namespace DesktopPet.Tests;

// Additional acceptance probes for the user's new decision. Copy-only: the
// upstream project and its existing tests/implementation are not modified.
public class ClarifiedSettingsDecisionTests
{
    [Theory]
    [InlineData("pet")]
    [InlineData("positionX")]
    [InlineData("positionY")]
    [InlineData("scale")]
    public void StringScale_PreservesOtherFields_AndUsesMedium(string field)
    {
        using var directory = new TempDir();
        var path = directory.Combine("settings.json");
        File.WriteAllText(path,
            """{"schemaVersion":1,"selectedPetId":"genba-neko","positionX":900,"positionY":400,"scalePercent":"big"}""");
        var loaded = new SettingsService(path).Load();
        switch (field)
        {
            case "pet": Assert.Equal("genba-neko", loaded.SelectedPetId); break;
            case "positionX": Assert.Equal(900, loaded.PositionX); break;
            case "positionY": Assert.Equal(400, loaded.PositionY); break;
            case "scale": Assert.Equal(CharacterScale.Medium, CharacterScales.FromPercent(loaded.ScalePercent)); break;
        }
    }
}
