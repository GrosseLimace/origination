// Microsoft namespaces
using Microsoft.Extensions.DependencyInjection;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Modules.Engagement.Interfaces;
using GrainOriginatorPortal.Infrastructure.Modules.Engagement.Repositories;

namespace GrainOriginatorPortal.Infrastructure.Modules.Engagement;

/// <summary>
/// The Engagement module's repositories: notes, reminders, daily recap groups and Teams channels.
/// <c>AddEngagementModule</c> in the Api calls this.
/// </summary>
public static class EngagementInfrastructure
{
    public static IServiceCollection AddEngagementInfrastructure(this IServiceCollection services)
    {
        services.AddScoped<INoteRepository, NoteRepository>();
        services.AddScoped<IReminderRepository, ReminderRepository>();
        services.AddScoped<IDailyRecapGroupRepository, DailyRecapGroupRepository>();
        services.AddScoped<ITeamsChannelRepository, TeamsChannelRepository>();
        return services;
    }
}
