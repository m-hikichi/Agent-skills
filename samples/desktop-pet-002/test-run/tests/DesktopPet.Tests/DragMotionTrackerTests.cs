using DesktopPet.Animation;
using DesktopPet.Models;
using Xunit;

namespace DesktopPet.Tests;

/// <summary>
/// spec FR-025 / data-model.md「DragMotionTracker」の規則を固定する。
/// 走り出し系のテストは、最後の結果だけでなく Move の全結果を検査し、2〜4 DIP の間に
/// 逆向きの走りが1回も返らないことを確認する（整合性分析 F1）。
/// </summary>
public class DragMotionTrackerTests
{
    private static readonly TimeSpan Tick = TimeSpan.FromMilliseconds(8);

    /// <summary>注入する時刻を進めながら Move を繰り返し、全結果を返す。</summary>
    private sealed class Driver
    {
        private readonly DragMotionTracker _tracker = new();
        public TimeSpan Now { get; private set; } = TimeSpan.FromSeconds(1);
        public DragMotionTracker Tracker => _tracker;

        public PetState Begin(Facing facing) => _tracker.Begin(facing, Now);

        public List<PetState> Move(double dx, double dy, int times = 1)
        {
            var rows = new List<PetState>();
            for (var i = 0; i < times; i++)
            {
                Now += Tick;
                rows.Add(_tracker.Move(new DipVector(dx, dy), Now));
            }
            return rows;
        }

        public PetState Wait(TimeSpan duration)
        {
            Now += duration;
            return _tracker.Poll(Now);
        }

        /// <summary>左右へ十分に動かして、指定の向きで走っている状態にする。</summary>
        public void RunInto(Facing facing)
        {
            Move(facing == Facing.Right ? 1 : -1, 0, times: 6);
            Assert.Equal(facing == Facing.Right ? PetState.RunningRight : PetState.RunningLeft, Wait(Tick));
        }
    }

    // ---- 走り出し: 向きは移動の符号で即時に確定する（保持している向きは使わない） ----

    [Theory]
    [InlineData(0.25)]
    [InlineData(0.5)]
    [InlineData(1.0)]
    [InlineData(6.0)] // 1回の移動で 2 DIP も 4 DIP も越える場合
    public void HeldRight_MovingLeft_StartsAsRunningLeftAndNeverShowsRunningRight(double step)
    {
        var d = new Driver();
        d.Begin(Facing.Right);

        var rows = d.Move(-step, 0, times: (int)Math.Ceiling(8 / step));

        Assert.DoesNotContain(PetState.RunningRight, rows);
        Assert.Equal(PetState.RunningLeft, rows.First(r => r != PetState.Idle));
        Assert.Equal(Facing.Left, d.Tracker.Facing);
    }

    [Theory]
    [InlineData(0.25)]
    [InlineData(0.5)]
    [InlineData(1.0)]
    [InlineData(6.0)]
    public void HeldLeft_MovingRight_StartsAsRunningRightAndNeverShowsRunningLeft(double step)
    {
        var d = new Driver();
        d.Begin(Facing.Left);

        var rows = d.Move(step, 0, times: (int)Math.Ceiling(8 / step));

        Assert.DoesNotContain(PetState.RunningLeft, rows);
        Assert.Equal(PetState.RunningRight, rows.First(r => r != PetState.Idle));
        Assert.Equal(Facing.Right, d.Tracker.Facing);
    }

    [Fact]
    public void RunStart_HappensExactlyWhenNetHorizontalTravelReachesTwoDip()
    {
        var d = new Driver();
        d.Begin(Facing.Right);

        Assert.Equal([PetState.Idle, PetState.Idle, PetState.Idle], d.Move(-0.5, 0, times: 3)); // 1.5 DIP
        Assert.Equal([PetState.RunningLeft], d.Move(-0.5, 0)); // ちょうど 2.0 DIP
    }

    [Fact]
    public void MovementUnderTwoDip_StaysIdle()
    {
        var d = new Driver();
        d.Begin(Facing.Right);

        Assert.All(d.Move(1.9, 0), row => Assert.Equal(PetState.Idle, row));
        Assert.False(d.Tracker.IsRunning);
    }

    // ---- 走行中の反転: 4 DIP のヒステリシスは向きの確定後にだけ適用する ----

    [Fact]
    public void RunningRight_LeftwardJitterUnderFourDip_KeepsRunningRight()
    {
        var d = new Driver();
        d.Begin(Facing.Left);
        d.RunInto(Facing.Right);

        Assert.All(d.Move(-1, 0, times: 3), row => Assert.Equal(PetState.RunningRight, row)); // 左へ 3 DIP
        Assert.All(d.Move(1, 0, times: 2), row => Assert.Equal(PetState.RunningRight, row));
    }

    [Fact]
    public void RunningRight_FourDipOfLeftwardTravel_FlipsToRunningLeft()
    {
        var d = new Driver();
        d.Begin(Facing.Left);
        d.RunInto(Facing.Right);

        var rows = d.Move(-1, 0, times: 4);

        Assert.Equal(
            [PetState.RunningRight, PetState.RunningRight, PetState.RunningRight, PetState.RunningLeft], rows);
    }

    [Fact]
    public void RunningLeft_RightwardJitterUnderFourDip_KeepsRunningLeft()
    {
        var d = new Driver();
        d.Begin(Facing.Right);
        d.RunInto(Facing.Left);

        Assert.All(d.Move(1, 0, times: 3), row => Assert.Equal(PetState.RunningLeft, row)); // 右へ 3 DIP
        Assert.All(d.Move(-1, 0, times: 2), row => Assert.Equal(PetState.RunningLeft, row));
    }

    [Fact]
    public void RunningLeft_FourDipOfRightwardTravel_FlipsToRunningRight()
    {
        var d = new Driver();
        d.Begin(Facing.Right);
        d.RunInto(Facing.Left);

        var rows = d.Move(1, 0, times: 4);

        Assert.Equal(
            [PetState.RunningLeft, PetState.RunningLeft, PetState.RunningLeft, PetState.RunningRight], rows);
    }

    [Fact]
    public void MovingWithTheFacing_ResetsTheOppositeAccumulator()
    {
        var d = new Driver();
        d.Begin(Facing.Left);
        d.RunInto(Facing.Right);

        // 左へ 3 → 右へ 1（累積が 0 に戻る）→ 左へ 3。合計は左へ 6 だが、連続では 4 に達していない
        d.Move(-1, 0, times: 3);
        d.Move(1, 0);
        var rows = d.Move(-1, 0, times: 3);

        Assert.All(rows, row => Assert.Equal(PetState.RunningRight, row));
    }

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(3)]
    public void AlternatingJitterWhileRunning_NeverFlips(double amplitude)
    {
        var d = new Driver();
        d.Begin(Facing.Left);
        d.RunInto(Facing.Right);

        for (var i = 0; i < 20; i++)
        {
            Assert.Equal([PetState.RunningRight], d.Move(-amplitude, 0));
            Assert.Equal([PetState.RunningRight], d.Move(amplitude, 0));
        }
    }

    // ---- 停止後の再開: 新しい走り出しとして扱う ----

    [Fact]
    public void RunningRight_ThenStill_ThenLeftTwoDip_StartsAsRunningLeft()
    {
        var d = new Driver();
        d.Begin(Facing.Left);
        d.RunInto(Facing.Right);

        Assert.Equal(PetState.Idle, d.Wait(DragMotionTracker.StillnessTimeout));
        var rows = d.Move(-0.5, 0, times: 4);

        Assert.DoesNotContain(PetState.RunningRight, rows);
        Assert.Equal(PetState.RunningLeft, rows[^1]);
    }

    [Fact]
    public void RunningLeft_ThenStill_ThenRightTwoDip_StartsAsRunningRight()
    {
        var d = new Driver();
        d.Begin(Facing.Right);
        d.RunInto(Facing.Left);

        Assert.Equal(PetState.Idle, d.Wait(DragMotionTracker.StillnessTimeout));
        var rows = d.Move(0.5, 0, times: 4);

        Assert.DoesNotContain(PetState.RunningLeft, rows);
        Assert.Equal(PetState.RunningRight, rows[^1]);
    }

    [Fact]
    public void Stillness_ResetsAccumulatorsEvenBeforeRunning()
    {
        var d = new Driver();
        d.Begin(Facing.Right);

        d.Move(1.5, 0);
        d.Wait(DragMotionTracker.StillnessTimeout);

        // 停止以降の累積で判定するので、停止前の 1.5 DIP は持ち越さない
        Assert.Equal([PetState.Idle], d.Move(1.5, 0));
    }

    // ---- 判定量は各軸の符号つき累積変位（経路長でも合成距離でもない） ----

    [Theory]
    [InlineData(-1.5, 1.5)] // 合成距離 約2.12 DIP
    [InlineData(1.9, -1.9)] // 合成距離 約2.69 DIP
    public void DiagonalMove_WithBothAxesUnderTwoDip_StaysIdleEvenIfCombinedDistanceExceedsTwo(double dx, double dy)
    {
        Assert.True(Math.Sqrt(dx * dx + dy * dy) > DragMotionTracker.MoveStartThresholdDip);

        // 1回の移動で
        var single = new Driver();
        single.Begin(Facing.Right);
        Assert.Equal([PetState.Idle], single.Move(dx, dy));

        // 同じ合計へ小刻みに到達しても同じ
        var stepped = new Driver();
        stepped.Begin(Facing.Right);
        const int parts = 5;
        Assert.All(stepped.Move(dx / parts, dy / parts, times: parts), row => Assert.Equal(PetState.Idle, row));

        // もう1歩で |netX| が 2 DIP に達したら、netX の符号の向きで走り出す
        var expected = dx > 0 ? PetState.RunningRight : PetState.RunningLeft;
        Assert.Equal([expected], single.Move(Math.Sign(dx) * 0.6, 0));
    }

    [Fact]
    public void InPlaceJitter_NeverStartsRunning()
    {
        // 経路長は 16 DIP まで伸びるが、正味の移動量は増えない
        var d = new Driver();
        d.Begin(Facing.Right);

        for (var i = 0; i < 10; i++)
        {
            Assert.Equal([PetState.Idle], d.Move(0.8, 0));
            Assert.Equal([PetState.Idle], d.Move(-0.8, 0));
        }
    }

    [Theory]
    [InlineData(0.3)]
    [InlineData(0.6)]
    [InlineData(1.0)]
    public void SlowHorizontalDragWithVerticalHandNoise_NeverShowsTheOppositeRow(double noise)
    {
        foreach (var step in new[] { 0.1, 0.25, 0.5, 1.0 })
        {
            var d = new Driver();
            d.Begin(Facing.Right); // 保持している向きは、これから動かす方向（左）と逆

            var sign = 1;
            for (var i = 0; i < 80; i++)
            {
                sign = -sign;
                Assert.DoesNotContain(PetState.RunningRight, d.Move(-step, sign * noise));
            }
            Assert.Equal(Facing.Left, d.Tracker.Facing);
        }
    }

    // ---- 上下のみの移動: 保持している向きで走る（FR-008） ----

    [Fact]
    public void VerticalOnly_RunsInTheHeldFacing()
    {
        var left = new Driver();
        left.Begin(Facing.Left);
        Assert.Equal([PetState.Idle, PetState.RunningLeft, PetState.RunningLeft], left.Move(0, 1, times: 3));

        var right = new Driver();
        right.Begin(Facing.Right);
        Assert.Equal([PetState.Idle, PetState.RunningRight, PetState.RunningRight], right.Move(0, -1, times: 3));
    }

    [Fact]
    public void InitialFacing_IsRight()
    {
        Assert.Equal(Facing.Right, new DragMotionTracker().Facing);
        Assert.Equal(Facing.Right, default(CharacterState).Facing);
    }

    [Fact]
    public void Facing_CarriesOverToTheNextDragThroughBegin()
    {
        var d = new Driver();
        d.Begin(Facing.Right);
        d.RunInto(Facing.Left);
        d.Tracker.End();
        var carried = d.Tracker.Facing;

        d.Begin(carried);

        Assert.Equal(Facing.Left, carried);
        Assert.Equal(PetState.RunningLeft, d.Move(0, 1, times: 2)[^1]); // 上下のみ → 前回の向き
    }

    [Fact]
    public void VerticalStart_ThenLeftTwoDip_CommitsLeftAtTwoDipNotFour()
    {
        var d = new Driver();
        d.Begin(Facing.Right);
        Assert.Equal(PetState.RunningRight, d.Move(0, 1, times: 3)[^1]);

        var rows = d.Move(-0.5, 0, times: 4);

        Assert.Equal(
            [PetState.RunningRight, PetState.RunningRight, PetState.RunningRight, PetState.RunningLeft], rows);
    }

    [Fact]
    public void VerticalMoveWhileRunning_LeavesTheFacingAlone()
    {
        var d = new Driver();
        d.Begin(Facing.Right);
        d.RunInto(Facing.Left);

        Assert.All(d.Move(0, 3, times: 5), row => Assert.Equal(PetState.RunningLeft, row));
    }

    // ---- 静止と終了 ----

    [Fact]
    public void PauseShorterThanThreeHundredMs_KeepsRunning()
    {
        var d = new Driver();
        d.Begin(Facing.Left);
        d.Move(1, 0, times: 6); // d.Now が最後の移動の時刻

        Assert.Equal(PetState.RunningRight, d.Wait(TimeSpan.FromMilliseconds(299)));
        Assert.True(d.Tracker.IsRunning);
    }

    [Fact]
    public void PauseOfThreeHundredMs_ReturnsToIdle()
    {
        var d = new Driver();
        d.Begin(Facing.Left);
        d.Move(1, 0, times: 6);
        var lastMoveAt = d.Now;

        Assert.False(d.Tracker.IsStill(lastMoveAt + TimeSpan.FromMilliseconds(299)));
        Assert.True(d.Tracker.IsStill(lastMoveAt + DragMotionTracker.StillnessTimeout));
        Assert.Equal(PetState.Idle, d.Wait(DragMotionTracker.StillnessTimeout));
        Assert.False(d.Tracker.IsRunning);
    }

    [Fact]
    public void ZeroDeltaMoves_DoNotPostponeStillness()
    {
        var d = new Driver();
        d.Begin(Facing.Left);
        d.RunInto(Facing.Right);
        var stillAt = d.Now + DragMotionTracker.StillnessTimeout;

        d.Move(0, 0, times: 10); // 移動量0のイベントは移動として数えない

        Assert.True(d.Tracker.IsStill(stillAt));
    }

    [Fact]
    public void End_ReturnsIdleAndKeepsTheFacing()
    {
        var d = new Driver();
        d.Begin(Facing.Right);
        d.RunInto(Facing.Left);

        Assert.Equal(PetState.Idle, d.Tracker.End());
        Assert.False(d.Tracker.IsRunning);
        Assert.Equal(Facing.Left, d.Tracker.Facing);
    }

    [Fact]
    public void Begin_ReturnsIdleAndClearsThePreviousRun()
    {
        var d = new Driver();
        d.Begin(Facing.Right);
        d.Move(1.5, 0);

        Assert.Equal(PetState.Idle, d.Begin(Facing.Right));
        Assert.Equal([PetState.Idle], d.Move(1.5, 0)); // 前回のドラッグの 1.5 DIP は持ち越さない
    }
}
