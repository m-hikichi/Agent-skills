using DesktopPet.Models;

namespace DesktopPet.Animation;

/// <summary>
/// ドラッグ中の移動量から、再生すべき行（Idle / RunningRight / RunningLeft）を決める純ロジック
/// （spec FR-025、data-model.md「DragMotionTracker」）。UI型に依存せず、時刻は単調増加の
/// <see cref="TimeSpan"/> として注入する。ドラッグ1回ごとに Begin → Move×n →（Poll）→ End の順で使う。
/// 「走り出し」と「走行中の反転」は別の規則であり、4 DIP のヒステリシスを走り出しに適用してはならない
/// （適用すると、保持している向きと逆へ動かしたとき、2〜4 DIP の間だけ逆向きの走りが表示される）。
/// </summary>
public sealed class DragMotionTracker
{
    /// <summary>走り出しと、走り出し時の向きの確定に使うしきい値（DIP）。</summary>
    public const double MoveStartThresholdDip = 2;

    /// <summary>走行中（向き確定後）の反転にだけ使うヒステリシス（DIP）。</summary>
    public const double FlipThresholdDip = 4;

    /// <summary>最後の移動からこの時間が経過したら、停止とみなして idle に戻す。</summary>
    public static readonly TimeSpan StillnessTimeout = TimeSpan.FromMilliseconds(300);

    private bool _isDirectionCommitted;
    private double _netXSinceStill; // 符号つき累積。右が正
    private double _netYSinceStill;
    private double _oppositeTravel;
    private TimeSpan _lastMoveAt;

    /// <summary>
    /// 保持している向き。左右の移動で確定・反転したときに変わり、停止・終了では変わらない。
    /// 走り出しで使われるのは、左右の累積が 2 DIP 未満の上下移動の場合だけ（FR-008）。
    /// </summary>
    public Facing Facing { get; private set; } = Facing.Right;

    public bool IsRunning { get; private set; }

    public PetState Begin(Facing facing, TimeSpan now)
    {
        Facing = facing;
        ResetRun();
        _lastMoveAt = now;
        return PetState.Idle;
    }

    /// <summary>前回のサンプルからの移動量（DIP）を受け取り、再生すべき行を返す。</summary>
    public PetState Move(DipVector delta, TimeSpan now)
    {
        if (delta.X == 0 && delta.Y == 0)
        {
            return CurrentRow; // 移動していない。停止判定の時刻も更新しない
        }
        _lastMoveAt = now;

        if (_isDirectionCommitted)
        {
            ApplyReversal(delta.X);
            return CurrentRow;
        }

        // 走り出しと向きの確定。判定量は各軸の符号つき累積変位で、経路長でも合成距離でもない
        _netXSinceStill += delta.X;
        _netYSinceStill += delta.Y;

        if (Math.Abs(_netXSinceStill) >= MoveStartThresholdDip)
        {
            // 符号だけで即時に確定する。保持している向きも、反転のヒステリシスも使わない
            Facing = _netXSinceStill > 0 ? Facing.Right : Facing.Left;
            _isDirectionCommitted = true;
            _oppositeTravel = 0;
            IsRunning = true;
        }
        else if (Math.Abs(_netYSinceStill) >= MoveStartThresholdDip)
        {
            // 上下のみの移動。保持している向きで走り出し、向きは未確定のままにする
            IsRunning = true;
        }
        return CurrentRow;
    }

    /// <summary>最後の移動から <see cref="StillnessTimeout"/> 以上経過していたら停止として扱う。</summary>
    public PetState Poll(TimeSpan now)
    {
        if (IsStill(now))
        {
            ResetRun(); // 次の移動は新しい走り出し。直前の走行の向きは左右の走り出しに引き継がない
        }
        return CurrentRow;
    }

    public bool IsStill(TimeSpan now) => now - _lastMoveAt >= StillnessTimeout;

    public PetState End()
    {
        ResetRun();
        return PetState.Idle;
    }

    private PetState CurrentRow =>
        !IsRunning ? PetState.Idle
        : Facing == Facing.Right ? PetState.RunningRight
        : PetState.RunningLeft;

    private void ApplyReversal(double deltaX)
    {
        if (deltaX == 0)
        {
            return; // 上下のみ。向きには触れない
        }

        var movingRight = deltaX > 0;
        if (movingRight == (Facing == Facing.Right))
        {
            _oppositeTravel = 0;
            return;
        }

        _oppositeTravel += Math.Abs(deltaX);
        if (_oppositeTravel >= FlipThresholdDip)
        {
            Facing = movingRight ? Facing.Right : Facing.Left;
            _oppositeTravel = 0;
        }
    }

    private void ResetRun()
    {
        IsRunning = false;
        _isDirectionCommitted = false;
        _netXSinceStill = 0;
        _netYSinceStill = 0;
        _oppositeTravel = 0;
    }
}
