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
    public int? ScalePercent { get; init; }
}
