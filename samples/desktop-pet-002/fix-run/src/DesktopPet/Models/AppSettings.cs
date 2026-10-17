using System.Text.Json;
using System.Text.Json.Serialization;

namespace DesktopPet.Models;

/// <summary>
/// 永続化されるアプリ設定（specs/002-idle-run-pet-resize/contracts/app-settings.md、schemaVersion: 1）。
/// 位置はウィンドウ左上のスクリーン座標（contracts/coordinate-spaces.md §1。物理ピクセル座標と一致し、
/// プライマリより左・上のモニタでは負の値が正常な値）。
/// </summary>
public sealed record AppSettings
{
    // ScalePercent は任意キーの追加なので版は上げない（旧ファイルも旧バージョンのアプリもそのまま動く）
    public const int CurrentSchemaVersion = 1;

    public int SchemaVersion { get; init; } = CurrentSchemaVersion;
    public string? SelectedPetId { get; init; }
    public double? PositionX { get; init; }
    public double? PositionY { get; init; }

    /// <summary>表示サイズ（75 / 100 / 125 / 150）。null・それ以外は Medium として扱う（CharacterScales.FromPercent）。</summary>
    [JsonConverter(typeof(SizeSettingConverter))]
    public int? ScalePercent { get; init; }
}

/// <summary>サイズ値だけの型不一致を局所的に復旧し、他の設定の読み込みを継続する。</summary>
public sealed class SizeSettingConverter : JsonConverter<int?>
{
    public override int? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        // 配列・オブジェクトも値全体を消費する。JSON構文自体が壊れている場合は
        // 例外をLoadへ伝え、従来どおりファイル全体の既定値にフォールバックする。
        using var value = JsonDocument.ParseValue(ref reader);
        return value.RootElement.ValueKind == JsonValueKind.Number
            && value.RootElement.TryGetInt32(out var percent) ? percent : null;
    }

    public override void Write(Utf8JsonWriter writer, int? value, JsonSerializerOptions options)
    {
        if (value is int percent)
            writer.WriteNumberValue(percent);
        else
            writer.WriteNullValue();
    }
}
