using System.Text.Json;
using System.Text.Json.Serialization;

namespace DesktopPet.Models;

/// <summary>
/// pet.json のマニフェスト（contracts/pet-package.md）。
/// 未知のキーは無視する（forward compatibility）。
/// </summary>
public sealed record PetManifest
{
    [JsonPropertyName("id")]
    public string? Id { get; init; }

    [JsonPropertyName("displayName")]
    public string? DisplayName { get; init; }

    [JsonPropertyName("description")]
    public string? Description { get; init; }

    [JsonPropertyName("spritesheetPath")]
    public string? SpritesheetPath { get; init; }

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        AllowTrailingCommas = true,
        ReadCommentHandling = JsonCommentHandling.Skip,
    };

    /// <summary>
    /// JSON文字列からマニフェストを解析・検証する。失敗してもスローしない。
    /// </summary>
    public static bool TryParse(string json, out PetManifest? manifest, out string? error)
    {
        manifest = null;
        try
        {
            var parsed = JsonSerializer.Deserialize<PetManifest>(json, JsonOptions);
            if (parsed is null)
            {
                error = "pet.json is empty";
                return false;
            }
            if (string.IsNullOrWhiteSpace(parsed.Id))
            {
                error = "pet.json: 'id' is required";
                return false;
            }
            if (string.IsNullOrWhiteSpace(parsed.DisplayName))
            {
                error = "pet.json: 'displayName' is required";
                return false;
            }
            if (string.IsNullOrWhiteSpace(parsed.SpritesheetPath))
            {
                error = "pet.json: 'spritesheetPath' is required";
                return false;
            }
            manifest = parsed;
            error = null;
            return true;
        }
        catch (JsonException ex)
        {
            error = $"pet.json: invalid JSON ({ex.Message})";
            return false;
        }
    }
}
