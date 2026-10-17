using DesktopPet.Animation;
using DesktopPet.Models;
using Xunit;

namespace DesktopPet.Tests;

public class AnimationEngineTests
{
    [Fact]
    public void InitialState_IsIdleFrameZero()
    {
        var engine = new AnimationEngine();

        Assert.Equal(PetState.Idle, engine.State);
        Assert.Equal(0, engine.FrameIndex);
        Assert.Equal(TimeSpan.FromMilliseconds(280), engine.CurrentFrameDuration);
    }

    [Fact]
    public void Advance_FollowsIdleDurationSequenceAndLoops()
    {
        var engine = new AnimationEngine();
        var expectedDurations = new[] { 280, 110, 110, 140, 140, 320 };

        // 1ループ目: フレーム0〜5 の時間が契約どおり
        for (var i = 0; i < expectedDurations.Length; i++)
        {
            Assert.Equal(i, engine.FrameIndex);
            Assert.Equal(TimeSpan.FromMilliseconds(expectedDurations[i]), engine.CurrentFrameDuration);
            var looped = engine.Advance();
            Assert.Equal(i == expectedDurations.Length - 1, looped);
        }

        // ループ後はフレーム0へ戻る（停止状態が存在しない）
        Assert.Equal(0, engine.FrameIndex);
    }

    [Fact]
    public void SwitchTo_RestartsAtFrameZero()
    {
        var engine = new AnimationEngine();
        engine.Advance();
        engine.Advance();
        Assert.Equal(2, engine.FrameIndex);

        engine.SwitchTo(PetState.RunningLeft);

        Assert.Equal(PetState.RunningLeft, engine.State);
        Assert.Equal(0, engine.FrameIndex);
        Assert.Equal(TimeSpan.FromMilliseconds(120), engine.CurrentFrameDuration);
    }

    [Theory]
    [InlineData(PetState.Idle, 6)]
    [InlineData(PetState.RunningRight, 8)]
    [InlineData(PetState.RunningLeft, 8)]
    [InlineData(PetState.Waving, 4)]
    [InlineData(PetState.Jumping, 5)]
    [InlineData(PetState.Failed, 8)]
    [InlineData(PetState.Waiting, 6)]
    [InlineData(PetState.Running, 6)]
    [InlineData(PetState.Review, 6)]
    public void Table_FrameCountsMatchContract(PetState state, int expectedFrames)
    {
        Assert.Equal(expectedFrames, AnimationTable.Get(state).FrameCount);
    }

    [Fact]
    public void Table_AllDurationsArePositive_AnimationNeverHalts()
    {
        foreach (var row in AnimationTable.All)
        {
            Assert.Equal((int)row.State, row.RowIndex);
            Assert.All(row.DurationsMs, d => Assert.True(d > 0));
        }
    }
}
