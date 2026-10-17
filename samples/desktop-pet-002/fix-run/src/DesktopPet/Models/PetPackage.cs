namespace DesktopPet.Models;

/// <summary>発見・検証済みのペットパッケージ1件。</summary>
public sealed record PetPackage
{
    public required PetManifest Manifest { get; init; }

    /// <summary>パッケージディレクトリの絶対パス。</summary>
    public required string DirectoryPath { get; init; }

    /// <summary>解決済みスプライトシートの絶対パス。</summary>
    public required string AtlasPath { get; init; }

    public string Id => Manifest.Id!;
    public string DisplayName => Manifest.DisplayName!;
}
