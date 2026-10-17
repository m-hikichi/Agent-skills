using DesktopPet.Services;
using Xunit;

namespace DesktopPet.Tests;

public class PetDiscoveryServiceTests : IDisposable
{
    private readonly TempDir _dir = new();

    public void Dispose() => _dir.Dispose();

    private string CreatePackage(string root, string folder, string manifestJson, bool withAtlas = true,
        string atlasName = "spritesheet.webp", int atlasWidth = 1536, int atlasHeight = 1872)
    {
        var dir = _dir.Combine(root, folder);
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "pet.json"), manifestJson);
        if (withAtlas)
        {
            TestAtlas.WriteWebp(Path.Combine(dir, atlasName), width: atlasWidth, height: atlasHeight);
        }
        return dir;
    }

    private static string Manifest(string id, string name = "Pet", string sheet = "spritesheet.webp") =>
        $$"""{ "id": "{{id}}", "displayName": "{{name}}", "spritesheetPath": "{{sheet}}" }""";

    [Fact]
    public void Discover_ValidPackage_IsListed()
    {
        var dir = CreatePackage("root1", "cat", Manifest("cat", "Cat"));

        var catalog = PetDiscoveryService.Discover([_dir.Combine("root1")]);

        var package = Assert.Single(catalog.Packages);
        Assert.Equal("cat", package.Id);
        Assert.Equal("Cat", package.DisplayName);
        Assert.Equal(dir, package.DirectoryPath);
        Assert.True(File.Exists(package.AtlasPath));
        Assert.Empty(catalog.Errors);
    }

    [Fact]
    public void Discover_InvalidManifest_IsExcludedWithReason()
    {
        CreatePackage("root1", "broken", """{ "displayName": "NoId", "spritesheetPath": "spritesheet.webp" }""");

        var catalog = PetDiscoveryService.Discover([_dir.Combine("root1")]);

        Assert.Empty(catalog.Packages);
        var error = Assert.Single(catalog.Errors);
        Assert.Contains("id", error.Reason);
    }

    [Fact]
    public void Discover_MissingSpritesheet_IsExcluded()
    {
        CreatePackage("root1", "ghost", Manifest("ghost"), withAtlas: false);

        var catalog = PetDiscoveryService.Discover([_dir.Combine("root1")]);

        Assert.Empty(catalog.Packages);
        var error = Assert.Single(catalog.Errors);
        Assert.Contains("spritesheet", error.Reason);
    }

    [Fact]
    public void Discover_WrongAtlasDimensions_IsExcluded()
    {
        CreatePackage("root1", "tiny", Manifest("tiny"), atlasWidth: 100, atlasHeight: 100);

        var catalog = PetDiscoveryService.Discover([_dir.Combine("root1")]);

        Assert.Empty(catalog.Packages);
        var error = Assert.Single(catalog.Errors);
        Assert.Contains("100", error.Reason);
    }

    [Fact]
    public void Discover_DirectoriesWithoutManifest_AreSilentlySkipped()
    {
        Directory.CreateDirectory(_dir.Combine("root1", "not-a-pet"));

        var catalog = PetDiscoveryService.Discover([_dir.Combine("root1")]);

        Assert.Empty(catalog.Packages);
        Assert.Empty(catalog.Errors);
    }

    [Fact]
    public void Discover_NonexistentRoot_DoesNotThrow()
    {
        var catalog = PetDiscoveryService.Discover([_dir.Combine("does-not-exist")]);

        Assert.Empty(catalog.Packages);
        Assert.Empty(catalog.Errors);
    }

    [Fact]
    public void Discover_FirstRootWinsAndDuplicateIdsAreExcluded()
    {
        CreatePackage("root1", "cat", Manifest("cat", "Cat One"));
        CreatePackage("root2", "cat-copy", Manifest("cat", "Cat Two"));
        CreatePackage("root2", "dog", Manifest("dog", "Dog"));

        var catalog = PetDiscoveryService.Discover([_dir.Combine("root1"), _dir.Combine("root2")]);

        Assert.Equal(2, catalog.Packages.Count);
        Assert.Equal("Cat One", catalog.Packages[0].DisplayName); // root1 が先
        Assert.Equal("dog", catalog.Packages[1].Id);
        var error = Assert.Single(catalog.Errors);
        Assert.Contains("duplicate", error.Reason);
    }
}
