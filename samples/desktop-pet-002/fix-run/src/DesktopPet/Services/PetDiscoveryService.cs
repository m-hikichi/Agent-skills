using DesktopPet.Models;

namespace DesktopPet.Services;

/// <summary>検証で除外したパッケージの診断情報。</summary>
public sealed record DiscoveryError(string Path, string Reason);

/// <summary>発見結果（検証通過分と除外理由の一覧）。</summary>
public sealed class PetCatalog
{
    public required IReadOnlyList<PetPackage> Packages { get; init; }
    public required IReadOnlyList<DiscoveryError> Errors { get; init; }
    public required IReadOnlyList<string> SearchRoots { get; init; }
}

/// <summary>
/// 既定の配置場所からペットパッケージを発見・検証する（contracts/pet-package.md）。
/// 1. ${CODEX_HOME:-~/.codex}/pets/
/// 2. リポジトリの .hatch-pet/packages/（カレントディレクトリから上方探索）
/// </summary>
public static class PetDiscoveryService
{
    public static IReadOnlyList<string> GetDefaultRoots()
    {
        var roots = new List<string>();

        var codexHome = Environment.GetEnvironmentVariable("CODEX_HOME");
        if (string.IsNullOrWhiteSpace(codexHome))
        {
            codexHome = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".codex");
        }
        roots.Add(Path.Combine(codexHome, "pets"));

        var repoPackages = FindUpward(".hatch-pet/packages", Directory.GetCurrentDirectory())
                        ?? FindUpward(".hatch-pet/packages", AppContext.BaseDirectory);
        if (repoPackages is not null)
        {
            roots.Add(repoPackages);
        }

        return roots;
    }

    private static string? FindUpward(string relative, string start)
    {
        try
        {
            var dir = new DirectoryInfo(start);
            while (dir is not null)
            {
                var candidate = Path.Combine(dir.FullName, relative);
                if (Directory.Exists(candidate))
                {
                    return candidate;
                }
                dir = dir.Parent;
            }
        }
        catch
        {
            // 探索失敗は「見つからない」と同じ扱い
        }
        return null;
    }

    /// <summary>指定ルート群を走査し、検証済みカタログを構築する。スローしない。</summary>
    public static PetCatalog Discover(IReadOnlyList<string> roots)
    {
        var packages = new List<PetPackage>();
        var errors = new List<DiscoveryError>();
        var seenIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var root in roots)
        {
            if (!Directory.Exists(root))
            {
                continue;
            }

            string[] dirs;
            try
            {
                dirs = Directory.GetDirectories(root);
            }
            catch (Exception ex)
            {
                errors.Add(new DiscoveryError(root, $"cannot enumerate: {ex.Message}"));
                continue;
            }

            foreach (var dir in dirs.OrderBy(d => d, StringComparer.OrdinalIgnoreCase))
            {
                var manifestPath = Path.Combine(dir, "pet.json");
                if (!File.Exists(manifestPath))
                {
                    continue; // pet.json を持たないディレクトリは対象外（エラーではない）
                }

                string json;
                try
                {
                    json = File.ReadAllText(manifestPath);
                }
                catch (Exception ex)
                {
                    errors.Add(new DiscoveryError(dir, $"cannot read pet.json: {ex.Message}"));
                    continue;
                }

                if (!PetManifest.TryParse(json, out var manifest, out var parseError))
                {
                    errors.Add(new DiscoveryError(dir, parseError!));
                    continue;
                }

                var atlasPath = Path.GetFullPath(Path.Combine(dir, manifest!.SpritesheetPath!));
                if (!File.Exists(atlasPath))
                {
                    errors.Add(new DiscoveryError(dir, $"spritesheet not found: {manifest.SpritesheetPath}"));
                    continue;
                }

                if (!SpriteSheetLoader.TryValidateDimensions(atlasPath, out var dimError))
                {
                    errors.Add(new DiscoveryError(dir, dimError!));
                    continue;
                }

                if (!seenIds.Add(manifest.Id!))
                {
                    errors.Add(new DiscoveryError(dir, $"duplicate pet id '{manifest.Id}' (first occurrence wins)"));
                    continue;
                }

                packages.Add(new PetPackage
                {
                    Manifest = manifest,
                    DirectoryPath = dir,
                    AtlasPath = atlasPath,
                });
            }
        }

        return new PetCatalog { Packages = packages, Errors = errors, SearchRoots = roots };
    }
}
