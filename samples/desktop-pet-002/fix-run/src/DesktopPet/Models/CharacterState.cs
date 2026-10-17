namespace DesktopPet.Models;

/// <summary>ペットが今どういう状況にあるか。時間経過や乱数で Idle から出る遷移は存在しない。</summary>
public enum CharacterActivity
{
    Idle,
    Dragging,
}

/// <summary>ペットの向き（最後に左右へ動かされた方向）。</summary>
public enum Facing
{
    Right,
    Left,
}

/// <summary>
/// キャラクターの状態。既定値は (Idle, Right)。向きはドラッグが終わっても保持し、
/// アプリの終了をまたいでは保存しない（FR-008）。表示サイズ・位置・再生中のアニメーションとは
/// 独立に管理する（FR-023）。
/// </summary>
public readonly record struct CharacterState(CharacterActivity Activity, Facing Facing);
