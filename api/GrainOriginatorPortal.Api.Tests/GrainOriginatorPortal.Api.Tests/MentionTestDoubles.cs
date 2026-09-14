using Moq;

using GrainOriginatorPortal.Api.Models;
using GrainOriginatorPortal.Api.Services;

namespace GrainOriginatorPortal.Api.Tests;

/// <summary>Shared test doubles for the note-mention pipeline.</summary>
public static class MentionTestDoubles
{
    /// <summary>A Teams-channel registry holding the given channels (none by default).
    /// <para>Most mention tests are not about channels, and NoteService only consults the registry
    /// when a note actually carries a <c>teams-channel</c> mention — so an empty stub keeps those
    /// tests on the same hot path the real code takes.</para></summary>
    public static ITeamsChannelService TeamsChannelStub(params TeamsChannelDto[] channels)
    {
        var mock = new Mock<ITeamsChannelService>();
        mock.Setup(s => s.GetAllAsync(It.IsAny<CancellationToken>())).ReturnsAsync(channels.ToList());
        return mock.Object;
    }
}
