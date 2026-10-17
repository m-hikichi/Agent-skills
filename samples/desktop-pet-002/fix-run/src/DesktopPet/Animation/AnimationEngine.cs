using DesktopPet.Models;

namespace DesktopPet.Animation;

/// <summary>
/// 固定テーブル（AnimationTable）に従いコマを進める純ロジックの計時エンジン。
/// 常に有限のコマ時間を返し、停止状態を持たない（憲法 Principle II）。
/// 実時間との接続（タイマー）はUI層が担う。
/// </summary>
public sealed class AnimationEngine
{
    private AnimationRow _row;
    private int _frameIndex;

    public AnimationEngine(PetState initialState = PetState.Idle)
    {
        _row = AnimationTable.Get(initialState);
    }

    public PetState State => _row.State;
    public int FrameIndex => _frameIndex;

    /// <summary>現在コマの表示時間。すべてのコマで正の値を持つ。</summary>
    public TimeSpan CurrentFrameDuration => TimeSpan.FromMilliseconds(_row.DurationsMs[_frameIndex]);

    /// <summary>状態を切り替え、コマ0から再生し直す（行をまたぐ中途コマ参照をしない）。</summary>
    public void SwitchTo(PetState state)
    {
        _row = AnimationTable.Get(state);
        _frameIndex = 0;
    }

    /// <summary>次のコマへ進める。行末から先頭へ戻った（1ループ完了した）場合に true。</summary>
    public bool Advance()
    {
        _frameIndex++;
        if (_frameIndex >= _row.FrameCount)
        {
            _frameIndex = 0;
            return true;
        }
        return false;
    }
}
