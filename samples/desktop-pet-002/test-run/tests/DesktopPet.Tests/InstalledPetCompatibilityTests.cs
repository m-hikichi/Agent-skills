using System.Security.Cryptography;
using DesktopPet.Models;
using DesktopPet.Services;
using Xunit;

namespace DesktopPet.Tests;

// TST-108 supplemental automated evidence only. Does not render a window,
// synthesize input, alter images or prove visual compatibility.
public class InstalledPetCompatibilityTests
{
    [Theory]
    [InlineData("genba-neko", 75, 144, 156)]
    [InlineData("genba-neko", 100, 192, 208)]
    [InlineData("genba-neko", 125, 240, 260)]
    [InlineData("genba-neko", 150, 288, 312)]
    [InlineData("yoshi-cat", 75, 144, 156)]
    [InlineData("yoshi-cat", 100, 192, 208)]
    [InlineData("yoshi-cat", 125, 240, 260)]
    [InlineData("yoshi-cat", 150, 288, 312)]
    public void InstalledAtlas_LoadsAllRows_AndComputesScaleWithoutMutation(
        string petId, int percent, double width, double height)
    {
        var root = @"C:\Users\m_hikichi\.codex\pets";
        var catalog = PetDiscoveryService.Discover([root]);
        Assert.Empty(catalog.Errors);
        var pet = Assert.Single(catalog.Packages, p => p.Id == petId);
        var manifestPath = Path.Combine(pet.DirectoryPath, "pet.json");
        var originalAtlasHash = SHA256.HashData(File.ReadAllBytes(pet.AtlasPath));
        var originalManifestHash = SHA256.HashData(File.ReadAllBytes(manifestPath));

        Assert.True(SpriteSheetLoader.TryLoad(pet.AtlasPath, out var sheet, out var error), error);
        foreach (var row in AnimationTable.All)
        {
            Assert.Equal(row.FrameCount, sheet!.Frames[row.State].Length);
            foreach (var frame in sheet.Frames[row.State])
            {
                Assert.Equal(192 * 208 * 4, frame.Bgra.Length);
                Assert.Equal(192 * 208, frame.Opaque.Length);
            }
        }
        var size = CharacterLayout.SizeDip(CharacterScales.FromPercent(percent));
        Assert.Equal(width, size.Width);
        Assert.Equal(height, size.Height);
        Assert.Equal(originalAtlasHash, SHA256.HashData(File.ReadAllBytes(pet.AtlasPath)));
        Assert.Equal(originalManifestHash, SHA256.HashData(File.ReadAllBytes(manifestPath)));
    }
}
