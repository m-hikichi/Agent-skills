using DesktopPet.Models;
using Xunit;

namespace DesktopPet.Tests;

public class PetManifestTests
{
    [Fact]
    public void TryParse_ValidManifest_Succeeds()
    {
        const string json = """
            {
              "id": "yoshi-cat",
              "displayName": "Yoshi Cat",
              "description": "A friendly cat.",
              "spritesheetPath": "spritesheet.webp"
            }
            """;

        Assert.True(PetManifest.TryParse(json, out var manifest, out var error));
        Assert.Null(error);
        Assert.Equal("yoshi-cat", manifest!.Id);
        Assert.Equal("Yoshi Cat", manifest.DisplayName);
        Assert.Equal("A friendly cat.", manifest.Description);
        Assert.Equal("spritesheet.webp", manifest.SpritesheetPath);
    }

    [Fact]
    public void TryParse_UnknownKeysAreIgnored()
    {
        const string json = """
            {
              "id": "a",
              "displayName": "A",
              "spritesheetPath": "s.webp",
              "futureField": { "nested": [1, 2, 3] }
            }
            """;

        Assert.True(PetManifest.TryParse(json, out var manifest, out _));
        Assert.Equal("a", manifest!.Id);
    }

    [Fact]
    public void TryParse_DescriptionIsOptional()
    {
        const string json = """{ "id": "a", "displayName": "A", "spritesheetPath": "s.webp" }""";

        Assert.True(PetManifest.TryParse(json, out var manifest, out _));
        Assert.Null(manifest!.Description);
    }

    [Theory]
    [InlineData("""{ "displayName": "A", "spritesheetPath": "s.webp" }""", "id")]
    [InlineData("""{ "id": "", "displayName": "A", "spritesheetPath": "s.webp" }""", "id")]
    [InlineData("""{ "id": "a", "spritesheetPath": "s.webp" }""", "displayName")]
    [InlineData("""{ "id": "a", "displayName": "A" }""", "spritesheetPath")]
    public void TryParse_MissingRequiredField_Fails(string json, string expectedField)
    {
        Assert.False(PetManifest.TryParse(json, out var manifest, out var error));
        Assert.Null(manifest);
        Assert.Contains(expectedField, error);
    }

    [Theory]
    [InlineData("not json at all")]
    [InlineData("{ broken")]
    [InlineData("")]
    public void TryParse_InvalidJson_FailsWithoutThrowing(string json)
    {
        Assert.False(PetManifest.TryParse(json, out _, out var error));
        Assert.NotNull(error);
    }
}
